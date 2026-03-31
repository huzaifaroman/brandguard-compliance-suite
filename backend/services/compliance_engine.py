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

CRITICAL_REG_IDS = {"REG-01", "REG-02", "REG-03", "REG-04", "REG-05"}


def _recalculate_verdict(llm_result: dict, short_hash: str = ""):
    violations = llm_result.get("violations", [])
    passed_details = llm_result.get("passed_details", [])
    passed_count = len([p for p in passed_details if p.get("status") != "not_applicable"]) if isinstance(passed_details, list) else 0
    violation_count = len(violations)
    applicable_total = passed_count + violation_count

    has_critical_regulatory = any(
        v.get("rule_id") in CRITICAL_REG_IDS or
        (v.get("severity") == "critical" and v.get("rule_id", "").startswith("REG-"))
        for v in violations
    )

    pass_rate = (passed_count / applicable_total * 100) if applicable_total > 0 else 0

    old_verdict = llm_result.get("verdict", "WARNING")
    if has_critical_regulatory:
        new_verdict = "FAIL"
    elif violation_count == 0:
        new_verdict = "PASS"
    elif pass_rate >= 95 and violation_count <= 2 and not has_critical_regulatory:
        new_verdict = "PASS"
    elif pass_rate >= 85 and not has_critical_regulatory:
        new_verdict = "WARNING"
    else:
        new_verdict = "FAIL"

    if new_verdict != old_verdict:
        logger.info("[%s] Verdict recalculated: %s → %s (pass_rate=%.1f%%, violations=%d, critical_reg=%s)",
                     short_hash, old_verdict, new_verdict, pass_rate, violation_count, has_critical_regulatory)
        llm_result["verdict"] = new_verdict

    if new_verdict == "PASS" and violation_count > 0:
        llm_result["confidence"] = max(llm_result.get("confidence", 0), int(pass_rate))
    elif new_verdict == "PASS" and violation_count == 0:
        llm_result["confidence"] = max(llm_result.get("confidence", 0), 99)


def _save_debug(filename: str, image_hash: str, vision_signals: dict, brand_detection: dict, llm_result: dict):
    try:
        from backend.services.llm_service import _format_detection_summary
        debug_data = {
            "_info": "Raw API responses — overwritten on each new analysis",
            "_timestamp": datetime.now(timezone.utc).isoformat(),
            "_filename": filename,
            "_image_hash": image_hash,
            "step_1_vision_api": vision_signals,
            "step_2_brand_detection_pass1": brand_detection,
            "step_2b_formatted_detection_sent_to_pass2": _format_detection_summary(brand_detection),
            "step_3_rule_evaluation_pass2": llm_result,
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

    logger.info("[%s] Pipeline START — %s (%dKB) — fresh analysis (no cache)", short_hash, filename, len(file_bytes) // 1024)

    blob_url, width, height = await upload_image(file_bytes, f"{image_hash[:16]}_{filename}")
    logger.info("[%s] ├─ Blob uploaded (%dx%d)", short_hash, width or 0, height or 0)

    vision_signals = await analyze_image(file_bytes)
    signal_count = len(vision_signals) if isinstance(vision_signals, dict) else 0
    logger.info("[%s] ├─ Vision done (%d signals)", short_hash, signal_count)

    llm_result = await analyze_compliance(vision_signals, rules, prompt, image_bytes=file_bytes)
    brand_detection = llm_result.pop("_brand_detection", {})
    logger.info("[%s] └─ LLM done → %s %s%%", short_hash,
                llm_result.get("verdict"), llm_result.get("confidence"))

    _save_debug(filename, image_hash, vision_signals, brand_detection, llm_result)

    _recalculate_verdict(llm_result, short_hash)

    session_id = str(uuid.uuid4())

    passed_details = llm_result.get("passed_details", [])
    full_passed_count = len(passed_details) if isinstance(passed_details, list) else 0

    checks_performed = llm_result.get("checks_performed", [])

    result = {
        "image_url": get_sas_url(blob_url),
        "image_width": width,
        "image_height": height,
        "verdict": llm_result.get("verdict", "WARNING"),
        "confidence": llm_result.get("confidence", 0),
        "summary": llm_result.get("summary", ""),
        "passed_details": passed_details,
        "violations": llm_result.get("violations", []),
        "checks_performed": checks_performed,
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
                    full_passed_count, json.dumps(passed_details),
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

    logger.info("[%s] Pipeline START (stream) — %s (%dKB) — fresh analysis (no cache)", short_hash, filename, len(file_bytes) // 1024)

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

    logger.info("[%s] └─ LLM done → %s %s%%", short_hash,
                llm_result.get("verdict"), llm_result.get("confidence"))

    _save_debug(filename, image_hash, vision_signals, brand_detection, llm_result)

    _recalculate_verdict(llm_result, short_hash)

    verdict = llm_result.get("verdict", "WARNING")
    confidence = llm_result.get("confidence", 0)
    violations = llm_result.get("violations", [])

    yield {"event": "step", "step": "evaluating", "progress": 85, "message": f"Rule evaluation complete — {verdict} ({confidence}%) with {len(violations)} violation(s)"}

    yield {"event": "step", "step": "persisting", "progress": 90, "message": "Saving results to database..."}

    session_id = str(uuid.uuid4())
    passed_details = llm_result.get("passed_details", [])
    full_passed_count = len(passed_details) if isinstance(passed_details, list) else 0
    checks_performed = llm_result.get("checks_performed", [])

    result = {
        "image_url": get_sas_url(blob_url),
        "image_width": width,
        "image_height": height,
        "verdict": verdict,
        "confidence": confidence,
        "summary": llm_result.get("summary", ""),
        "passed_details": passed_details,
        "violations": violations,
        "checks_performed": checks_performed,
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
                    full_passed_count, json.dumps(passed_details),
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
