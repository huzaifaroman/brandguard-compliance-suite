import hashlib
import uuid
import json
from typing import Optional

from backend.services.blob_service import upload_image
from backend.services.vision_service import analyze_image
from backend.services.llm_service import analyze_compliance
from backend import redis_client, database


async def analyze_single_image(
    file_bytes: bytes,
    filename: str,
    rules: dict,
    prompt: Optional[str] = None,
) -> dict:
    """
    Full compliance pipeline for a single image.
    Returns structured compliance result.
    """
    image_hash = hashlib.sha256(file_bytes).hexdigest()

    cached = await redis_client.get_cached_analysis(image_hash)
    if cached:
        cached["cached"] = True
        return cached

    blob_url, width, height = await upload_image(file_bytes, f"{image_hash[:16]}_{filename}")
    vision_signals = await analyze_image(file_bytes)
    llm_result = await analyze_compliance(vision_signals, rules, prompt)

    session_id = str(uuid.uuid4())

    result = {
        "image_url": blob_url,
        "image_width": width,
        "image_height": height,
        "verdict": llm_result.get("verdict", "WARNING"),
        "confidence": llm_result.get("confidence", 0),
        "summary": llm_result.get("summary", ""),
        "checks_passed": llm_result.get("checks_passed", 0),
        "violations": llm_result.get("violations", []),
        "session_id": session_id,
        "cached": False,
        "image_hash": image_hash,
    }

    pool = await database.get_pool()
    if pool:
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
                result["checks_passed"], prompt, session_id,
            )
            analysis_id = row["id"]
            await conn.execute(
                "INSERT INTO chat_sessions (session_id, analysis_id) VALUES ($1, $2)",
                session_id, analysis_id,
            )

    await redis_client.cache_analysis(image_hash, result)
    return result
