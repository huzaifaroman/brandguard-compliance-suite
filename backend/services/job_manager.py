import asyncio
import logging
import time
import uuid
from typing import Optional

logger = logging.getLogger("backend.services.jobs")

_jobs: dict[str, dict] = {}

DETECTION_MESSAGES = [
    "Examining the image for ZONNIC brand elements...",
    "Identifying logo placement and halo position...",
    "Analyzing colours, background, and typography...",
    "Checking for regulatory text and warnings...",
]

EVALUATION_MESSAGES = [
    "Comparing brand elements against compliance rules...",
    "Evaluating logo and halo rules...",
    "Checking regulatory requirements...",
    "Assessing colour and gradient compliance...",
    "Reviewing typography and content rules...",
    "Finalizing compliance verdict...",
]


def create_job(file_bytes: bytes, filename: str, rules: dict, prompt: Optional[str] = None) -> str:
    job_id = str(uuid.uuid4())[:8]
    _jobs[job_id] = {
        "status": "queued",
        "step": "uploading",
        "progress": 5,
        "message": "Starting analysis...",
        "result": None,
        "error": None,
        "created_at": time.time(),
        "file_bytes": file_bytes,
        "filename": filename,
        "rules": rules,
        "prompt": prompt,
        "llm_phase": None,
        "llm_phase_start": None,
    }
    return job_id


def get_job(job_id: str) -> Optional[dict]:
    job = _jobs.get(job_id)
    if not job:
        return None

    response = {
        "status": job["status"],
        "step": job["step"],
        "progress": job["progress"],
        "message": job["message"],
    }

    if job["status"] == "done":
        response["result"] = job["result"]
    elif job["status"] == "error":
        response["error"] = job["error"]
    elif job["llm_phase"] and job["llm_phase_start"]:
        last_cb = job.get("last_callback_time", 0)
        if time.time() - last_cb > 2:
            elapsed = time.time() - job["llm_phase_start"]
            if job["llm_phase"] == "detecting":
                idx = min(int(elapsed / 5), len(DETECTION_MESSAGES) - 1)
                response["message"] = DETECTION_MESSAGES[idx]
                response["progress"] = max(job["progress"], min(35 + int(elapsed * 0.8), 55))
            elif job["llm_phase"] == "evaluating":
                idx = min(int(elapsed / 6), len(EVALUATION_MESSAGES) - 1)
                response["message"] = EVALUATION_MESSAGES[idx]
                response["progress"] = max(job["progress"], min(60 + int(elapsed * 0.5), 88))

    return response


async def run_job(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        return

    job["status"] = "running"
    job["step"] = "uploading"
    job["progress"] = 10
    job["message"] = "Uploading image to cloud storage..."

    file_bytes = job.pop("file_bytes")
    image_bytes_for_llm = file_bytes
    filename = job["filename"]
    rules = job["rules"]
    prompt = job["prompt"]

    try:
        import hashlib
        from backend.services.blob_service import upload_image, get_sas_url
        from backend.services.vision_service import analyze_image
        from backend.services.llm_service import analyze_compliance
        from backend import redis_client, database
        import json

        image_hash = hashlib.sha256(file_bytes).hexdigest()
        short_hash = image_hash[:8]

        cached = await redis_client.get_cached_analysis(image_hash)
        if cached:
            cached["cached"] = True
            if "image_url" in cached:
                cached["image_url"] = get_sas_url(cached["image_url"])
            job["status"] = "done"
            job["step"] = "done"
            job["progress"] = 100
            job["message"] = "Cached result found"
            job["result"] = cached
            logger.info("[%s] Cache HIT (job)", short_hash)
            return

        logger.info("[%s] Pipeline START (job) — %s (%dKB)", short_hash, filename, len(file_bytes) // 1024)

        blob_url, width, height = await upload_image(file_bytes, f"{image_hash[:16]}_{filename}")
        logger.info("[%s] ├─ Blob uploaded (%dx%d)", short_hash, width or 0, height or 0)

        job["step"] = "vision"
        job["progress"] = 20
        job["message"] = f"Image uploaded ({width or 0}x{height or 0}). Running image analysis..."

        vision_signals = await analyze_image(file_bytes)
        signal_count = len(vision_signals) if isinstance(vision_signals, dict) else 0
        logger.info("[%s] ├─ Vision done (%d signals)", short_hash, signal_count)

        job["step"] = "llm"
        job["progress"] = 35
        job["message"] = "Examining image for ZONNIC brand elements..."
        job["llm_phase"] = "detecting"
        job["llm_phase_start"] = time.time()

        async def progress_callback(phase, progress, message):
            job["llm_phase"] = phase
            if phase != job.get("_last_phase"):
                job["llm_phase_start"] = time.time()
                job["_last_phase"] = phase
            job["progress"] = progress
            job["message"] = message
            job["last_callback_time"] = time.time()

        llm_result = await analyze_compliance(
            vision_signals, rules, prompt,
            image_bytes=image_bytes_for_llm,
            progress_callback=progress_callback,
        )

        brand_detection = llm_result.pop("_brand_detection", {})

        logger.info("[%s] └─ LLM done → %s %s%%", short_hash,
                    llm_result.get("verdict"), llm_result.get("confidence"))

        from backend.services.compliance_engine import _save_debug
        _save_debug(filename, image_hash, {"vision_signals": vision_signals, "brand_detection": brand_detection}, llm_result)

        job["step"] = "persisting"
        job["progress"] = 90
        job["message"] = "Saving results..."
        job["llm_phase"] = None

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
                        """INSERT INTO analyses
                            (image_hash, blob_url, image_width, image_height, verdict,
                             confidence, violations_json, checks_passed, passed_details_json,
                             prompt, session_id, summary, content_type_detected, background_type_detected)
                        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12,$13,$14)
                        RETURNING id""",
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
                logger.error("Database insert error: %s", e)

        if result["confidence"] > 0:
            await redis_client.cache_analysis(image_hash, result)

        job["status"] = "done"
        job["step"] = "done"
        job["progress"] = 100
        job["message"] = "Analysis complete"
        job["result"] = result
        logger.info("[%s] Job complete → %s %s%%", short_hash, result["verdict"], result["confidence"])

    except Exception as e:
        logger.error("Job %s failed: %s: %s", job_id, type(e).__name__, e)
        job["status"] = "error"
        job["error"] = str(e)
        job["message"] = f"Analysis failed: {type(e).__name__}"


def cleanup_old_jobs():
    cutoff = time.time() - 600
    to_remove = [
        jid for jid, j in _jobs.items()
        if j["created_at"] < cutoff and j["status"] in ("done", "error")
    ]
    for jid in to_remove:
        del _jobs[jid]
