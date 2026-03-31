import hashlib
import uuid
import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional, AsyncGenerator
from pathlib import Path

from backend.services.blob_service import upload_image, get_sas_url
from backend.services.vision_service import analyze_image
from backend.services.llm_service import analyze_compliance
from backend import redis_client, database

logger = logging.getLogger("backend.services.engine")

DEBUG_FILE = Path(__file__).parent.parent / "debug_raw_responses.json"


def _save_debug(filename: str, image_hash: str, vision_raw: dict, llm_raw: dict):
    try:
        debug_data = {
            "_info": "Raw API responses — overwritten on each new analysis",
            "_timestamp": datetime.now(timezone.utc).isoformat(),
            "_filename": filename,
            "_image_hash": image_hash,
            "vision_raw": vision_raw,
            "llm_raw": llm_raw,
        }
        DEBUG_FILE.write_text(json.dumps(debug_data, indent=2, default=str))
        logger.info("Debug raw responses saved to %s", DEBUG_FILE)
    except Exception as e:
        logger.warning("Failed to save debug file: %s", e)


async def analyze_single_image(
    file_bytes: bytes,
    filename: str,
    rules: dict,
    prompt: Optional[str] = None,
) -> dict:
    image_hash = hashlib.sha256(file_bytes).hexdigest()
    short_hash = image_hash[:8]

    cached = await redis_client.get_cached_analysis(image_hash)
    if cached:
        cached["cached"] = True
        if "image_url" in cached:
            cached["image_url"] = get_sas_url(cached["image_url"])
        if "passed_details" not in cached and "checks_passed" in cached:
            old = cached.pop("checks_passed", [])
            if isinstance(old, list):
                cached["passed_details"] = [
                    {"rule_id": rid, "category": "Content", "detail": f"Rule {rid} passed (legacy)", "status": "pass"} for rid in old
                ]
            else:
                cached["passed_details"] = []
        for pd in cached.get("passed_details", []):
            if "status" not in pd:
                pd["status"] = "pass"
        logger.info("[%s] Cache HIT", short_hash)
        return cached

    logger.info("[%s] Pipeline START — %s (%dKB)", short_hash, filename, len(file_bytes) // 1024)

    blob_url, width, height = await upload_image(file_bytes, f"{image_hash[:16]}_{filename}")
    logger.info("[%s] ├─ Blob uploaded (%dx%d)", short_hash, width or 0, height or 0)

    vision_signals = await analyze_image(file_bytes)
    signal_count = len(vision_signals) if isinstance(vision_signals, dict) else 0
    logger.info("[%s] ├─ Vision done (%d signals)", short_hash, signal_count)

    llm_result = await analyze_compliance(vision_signals, rules, prompt, image_bytes=file_bytes)
    brand_detection = llm_result.pop("_brand_detection", {})
    logger.info("[%s] └─ LLM done → %s %s%%", short_hash,
                llm_result.get("verdict"), llm_result.get("confidence"))

    _save_debug(filename, image_hash, {"vision_signals": vision_signals, "brand_detection": brand_detection}, llm_result)

    session_id = str(uuid.uuid4())

    passed_details = llm_result.get("passed_details", [])
    passed_count = len(passed_details) if isinstance(passed_details, list) else 0

    result = {
        "image_url": get_sas_url(blob_url),
        "image_width": width,
        "image_height": height,
        "verdict": llm_result.get("verdict", "WARNING"),
        "confidence": llm_result.get("confidence", 0),
        "summary": llm_result.get("summary", ""),
        "passed_details": passed_details,
        "violations": llm_result.get("violations", []),
        "content_type_detected": llm_result.get("content_type_detected", "unknown"),
        "background_type_detected": llm_result.get("background_type_detected", "unknown"),
        "session_id": session_id,
        "cached": False,
        "image_hash": image_hash,
    }

    pool = await database.get_pool()
    if pool:
        try:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    """
                    INSERT INTO analyses
                        (image_hash, blob_url, image_width, image_height, verdict,
                         confidence, violations_json, checks_passed, passed_details_json,
                         prompt, session_id, summary, content_type_detected, background_type_detected)
                    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, $12, $13, $14)
                    RETURNING id
                    """,
                    image_hash, blob_url, width, height,
                    result["verdict"], result["confidence"],
                    json.dumps(result["violations"]),
                    passed_count, json.dumps(passed_details),
                    prompt, session_id,
                    result.get("summary", ""),
                    result.get("content_type_detected", "unknown"),
                    result.get("background_type_detected", "unknown"),
                )
                analysis_id = row["id"]
                await conn.execute(
                    "INSERT INTO chat_sessions (session_id, analysis_id) VALUES ($1, $2)",
                    session_id, analysis_id,
                )
        except Exception as e:
            logger.error(f"Database insert error: {e}")

    if result["confidence"] > 0:
        await redis_client.cache_analysis(image_hash, result)
    return result


async def analyze_single_image_streaming(
    file_bytes: bytes,
    filename: str,
    rules: dict,
    prompt: Optional[str] = None,
) -> AsyncGenerator[dict, None]:
    image_hash = hashlib.sha256(file_bytes).hexdigest()
    short_hash = image_hash[:8]

    cached = await redis_client.get_cached_analysis(image_hash)
    if cached:
        cached["cached"] = True
        if "image_url" in cached:
            cached["image_url"] = get_sas_url(cached["image_url"])
        if "passed_details" not in cached and "checks_passed" in cached:
            old = cached.pop("checks_passed", [])
            if isinstance(old, list):
                cached["passed_details"] = [
                    {"rule_id": rid, "category": "Content", "detail": f"Rule {rid} passed (legacy)", "status": "pass"} for rid in old
                ]
            else:
                cached["passed_details"] = []
        for pd in cached.get("passed_details", []):
            if "status" not in pd:
                pd["status"] = "pass"
        logger.info("[%s] Cache HIT (stream)", short_hash)
        yield {"event": "step", "step": "cache_hit", "progress": 100, "message": "Cached result found"}
        yield {"event": "result", "data": cached}
        return

    logger.info("[%s] Pipeline START (stream) — %s (%dKB)", short_hash, filename, len(file_bytes) // 1024)

    yield {"event": "step", "step": "uploading", "progress": 5, "message": "Uploading image to cloud storage..."}

    blob_url, width, height = await upload_image(file_bytes, f"{image_hash[:16]}_{filename}")
    logger.info("[%s] ├─ Blob uploaded (%dx%d)", short_hash, width or 0, height or 0)

    yield {"event": "step", "step": "uploading", "progress": 15, "message": f"Image uploaded ({width or 0}×{height or 0})"}

    yield {"event": "step", "step": "vision", "progress": 20, "message": "Running image analysis..."}

    vision_signals = await analyze_image(file_bytes)
    signal_count = len(vision_signals) if isinstance(vision_signals, dict) else 0
    logger.info("[%s] ├─ Vision done (%d signals)", short_hash, signal_count)

    yield {"event": "step", "step": "vision", "progress": 30, "message": f"Image analysis complete — {signal_count} signals extracted"}

    yield {"event": "step", "step": "detecting", "progress": 35, "message": "Identifying ZONNIC brand elements in the image..."}

    async def progress_callback(phase, progress, message):
        pass

    llm_result = await analyze_compliance(vision_signals, rules, prompt, image_bytes=file_bytes, progress_callback=progress_callback)

    brand_detection = llm_result.pop("_brand_detection", {})

    halo_info = brand_detection.get("halo", {})
    logo_info = brand_detection.get("logo", {})
    detection_parts = []
    if logo_info.get("present"):
        detection_parts.append("Logo found")
    if halo_info.get("halo_on_c"):
        detection_parts.append("halo on C (correct)")
    elif halo_info.get("halo_on_z"):
        detection_parts.append("halo on Z (wrong letter)")
    detection_msg = ", ".join(detection_parts) if detection_parts else "Detection complete"

    yield {"event": "step", "step": "detecting", "progress": 60, "message": f"Brand detection: {detection_msg}"}

    verdict = llm_result.get("verdict", "WARNING")
    confidence = llm_result.get("confidence", 0)
    violations = llm_result.get("violations", [])
    logger.info("[%s] └─ LLM done → %s %s%%", short_hash, verdict, confidence)

    _save_debug(filename, image_hash, {"vision_signals": vision_signals, "brand_detection": brand_detection}, llm_result)

    yield {"event": "step", "step": "evaluating", "progress": 85, "message": f"Rule evaluation complete — {verdict} ({confidence}%) with {len(violations)} violation(s)"}

    yield {"event": "step", "step": "persisting", "progress": 90, "message": "Saving results to database..."}

    session_id = str(uuid.uuid4())
    passed_details = llm_result.get("passed_details", [])
    passed_count = len(passed_details) if isinstance(passed_details, list) else 0

    result = {
        "image_url": get_sas_url(blob_url),
        "image_width": width,
        "image_height": height,
        "verdict": verdict,
        "confidence": confidence,
        "summary": llm_result.get("summary", ""),
        "passed_details": passed_details,
        "violations": violations,
        "content_type_detected": llm_result.get("content_type_detected", "unknown"),
        "background_type_detected": llm_result.get("background_type_detected", "unknown"),
        "session_id": session_id,
        "cached": False,
        "image_hash": image_hash,
    }

    pool = await database.get_pool()
    if pool:
        try:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    """
                    INSERT INTO analyses
                        (image_hash, blob_url, image_width, image_height, verdict,
                         confidence, violations_json, checks_passed, passed_details_json,
                         prompt, session_id, summary, content_type_detected, background_type_detected)
                    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, $12, $13, $14)
                    RETURNING id
                    """,
                    image_hash, blob_url, width, height,
                    result["verdict"], result["confidence"],
                    json.dumps(result["violations"]),
                    passed_count, json.dumps(passed_details),
                    prompt, session_id,
                    result.get("summary", ""),
                    result.get("content_type_detected", "unknown"),
                    result.get("background_type_detected", "unknown"),
                )
                analysis_id = row["id"]
                await conn.execute(
                    "INSERT INTO chat_sessions (session_id, analysis_id) VALUES ($1, $2)",
                    session_id, analysis_id,
                )
        except Exception as e:
            logger.error(f"Database insert error: {e}")

    if result["confidence"] > 0:
        await redis_client.cache_analysis(image_hash, result)

    yield {"event": "step", "step": "done", "progress": 100, "message": "Analysis complete"}
    yield {"event": "result", "data": result}
