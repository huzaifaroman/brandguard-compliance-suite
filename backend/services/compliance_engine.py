import hashlib
import uuid
import json
import logging
from typing import Optional

from backend.services.blob_service import upload_image
from backend.services.vision_service import analyze_image
from backend.services.llm_service import analyze_compliance
from backend import redis_client, database

logger = logging.getLogger("backend.services.engine")


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
        logger.info("[%s] Cache HIT", short_hash)
        return cached

    logger.info("[%s] Pipeline START — %s (%dKB)", short_hash, filename, len(file_bytes) // 1024)

    blob_url, width, height = await upload_image(file_bytes, f"{image_hash[:16]}_{filename}")
    logger.info("[%s] ├─ Blob uploaded (%dx%d)", short_hash, width or 0, height or 0)

    vision_signals = await analyze_image(file_bytes)
    signal_count = len(vision_signals) if isinstance(vision_signals, dict) else 0
    logger.info("[%s] ├─ Vision done (%d signals)", short_hash, signal_count)

    llm_result = await analyze_compliance(vision_signals, rules, prompt)
    logger.info("[%s] └─ LLM done → %s %s%%", short_hash,
                llm_result.get("verdict"), llm_result.get("confidence"))

    session_id = str(uuid.uuid4())

    checks_passed = llm_result.get("checks_passed", [])
    checks_passed_count = len(checks_passed) if isinstance(checks_passed, list) else checks_passed

    result = {
        "image_url": blob_url,
        "image_width": width,
        "image_height": height,
        "verdict": llm_result.get("verdict", "WARNING"),
        "confidence": llm_result.get("confidence", 0),
        "summary": llm_result.get("summary", ""),
        "checks_passed": checks_passed,
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
                         confidence, violations_json, checks_passed, prompt, session_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
                    RETURNING id
                    """,
                    image_hash, blob_url, width, height,
                    result["verdict"], result["confidence"],
                    json.dumps(result["violations"]),
                    checks_passed_count, prompt, session_id,
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
