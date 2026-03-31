import asyncio
import uuid
import json
import logging
from fastapi import APIRouter, UploadFile, File, Request, HTTPException
from typing import List, Dict, Any

from backend.models.schemas import BatchResult, BatchSummary, BatchImageResult
from backend.services.compliance_engine import analyze_single_image
from backend import database, redis_client

logger = logging.getLogger("backend.routers.batch")

router = APIRouter(prefix="/api", tags=["batch"])

MAX_BATCH_SIZE = 10
MAX_FILE_SIZE = 20 * 1024 * 1024
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}

_batch_jobs: Dict[str, Dict[str, Any]] = {}


@router.post("/batch/start")
async def batch_start(
    request: Request,
    files: List[UploadFile] = File(...),
):
    if len(files) > MAX_BATCH_SIZE:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_BATCH_SIZE} files allowed")
    if len(files) == 0:
        raise HTTPException(status_code=400, detail="No files provided")

    batch_id = str(uuid.uuid4())
    rules = getattr(request.app.state, "rules", {})

    file_data = []
    for f in files:
        content = await f.read()
        file_data.append({
            "filename": f.filename or "image.png",
            "content_type": f.content_type,
            "bytes": content,
        })

    _batch_jobs[batch_id] = {
        "status": "processing",
        "total": len(file_data),
        "completed": 0,
        "step": "uploading",
        "current_image": "",
        "image_step": "uploading",
        "sub_progress": 0,
        "result": None,
    }

    logger.info("Batch %s: %d file(s) — job started", batch_id[:8], len(file_data))

    asyncio.create_task(_run_batch(batch_id, file_data, rules))

    return {"batch_id": batch_id, "total": len(file_data)}


@router.get("/batch/status/{batch_id}")
async def batch_status(batch_id: str):
    job = _batch_jobs.get(batch_id)
    if not job:
        cached = await redis_client.cache_get(f"batch:{batch_id}")
        if cached:
            return {
                "status": "done",
                "total": cached.get("total_images", 0),
                "completed": cached.get("total_images", 0),
                "step": "done",
                "result": cached,
            }
        raise HTTPException(status_code=404, detail="Batch not found")
    return {
        "status": job["status"],
        "total": job["total"],
        "completed": job["completed"],
        "step": job["step"],
        "current_image": job.get("current_image", ""),
        "image_step": job.get("image_step", ""),
        "sub_progress": job.get("sub_progress", 0),
        "result": job["result"],
    }


@router.post("/batch", response_model=BatchResult)
async def batch_analyze(
    request: Request,
    files: List[UploadFile] = File(...),
):
    logger.info("Batch (legacy sync): %d file(s)", len(files))

    if len(files) > MAX_BATCH_SIZE:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_BATCH_SIZE} files allowed")
    if len(files) == 0:
        raise HTTPException(status_code=400, detail="No files provided")

    rules = getattr(request.app.state, "rules", {})
    batch_id = str(uuid.uuid4())

    file_data = []
    for f in files:
        content = await f.read()
        file_data.append({
            "filename": f.filename or "image.png",
            "content_type": f.content_type,
            "bytes": content,
        })

    results = await _process_files(file_data, rules, None)

    summary = BatchSummary(
        passed=sum(1 for r in results if r.verdict == "PASS"),
        failed=sum(1 for r in results if r.verdict == "FAIL"),
        warnings=sum(1 for r in results if r.verdict == "WARNING"),
    )

    batch_result = BatchResult(
        batch_id=batch_id,
        total_images=len(results),
        summary=summary,
        results=list(results),
    )

    await _persist_batch(batch_id, batch_result, summary)
    return batch_result


async def _run_batch(batch_id: str, file_data: list, rules: dict):
    try:
        job = _batch_jobs[batch_id]
        job["step"] = "vision"

        results = await _process_files(file_data, rules, batch_id)

        summary = BatchSummary(
            passed=sum(1 for r in results if r.verdict == "PASS"),
            failed=sum(1 for r in results if r.verdict == "FAIL"),
            warnings=sum(1 for r in results if r.verdict == "WARNING"),
        )

        batch_result = BatchResult(
            batch_id=batch_id,
            total_images=len(results),
            summary=summary,
            results=list(results),
        )

        await _persist_batch(batch_id, batch_result, summary)

        job["status"] = "done"
        job["step"] = "done"
        job["completed"] = job["total"]
        job["result"] = batch_result.model_dump()

        logger.info("Batch %s complete: pass=%d fail=%d warn=%d",
                    batch_id[:8], summary.passed, summary.failed, summary.warnings)

        asyncio.get_event_loop().call_later(600, lambda: _batch_jobs.pop(batch_id, None))
    except Exception as e:
        logger.error("Batch %s failed: %s", batch_id[:8], e)
        job = _batch_jobs.get(batch_id)
        if job:
            job["status"] = "error"
            job["step"] = "error"
            job["result"] = {"error": str(e)}


async def _process_files(file_data: list, rules: dict, batch_id: str | None) -> list:
    async def process_one(fd: dict, index: int) -> BatchImageResult:
        try:
            if batch_id and batch_id in _batch_jobs:
                job = _batch_jobs[batch_id]
                job["current_image"] = fd["filename"]
                job["image_step"] = "uploading"
                job["sub_progress"] = (index / len(file_data)) * 100

            if fd["content_type"] and fd["content_type"] not in ALLOWED_TYPES:
                if batch_id and batch_id in _batch_jobs:
                    _batch_jobs[batch_id]["completed"] = _batch_jobs[batch_id].get("completed", 0) + 1
                return BatchImageResult(
                    image_name=fd["filename"],
                    verdict="WARNING",
                    confidence=0,
                    error=f"Unsupported file type: {fd['content_type']}",
                )

            if len(fd["bytes"]) == 0:
                if batch_id and batch_id in _batch_jobs:
                    _batch_jobs[batch_id]["completed"] = _batch_jobs[batch_id].get("completed", 0) + 1
                return BatchImageResult(
                    image_name=fd["filename"],
                    verdict="WARNING",
                    confidence=0,
                    error="Empty file",
                )

            if len(fd["bytes"]) > MAX_FILE_SIZE:
                if batch_id and batch_id in _batch_jobs:
                    _batch_jobs[batch_id]["completed"] = _batch_jobs[batch_id].get("completed", 0) + 1
                return BatchImageResult(
                    image_name=fd["filename"],
                    verdict="WARNING",
                    confidence=0,
                    error="File too large (max 20MB)",
                )

            if batch_id and batch_id in _batch_jobs:
                job = _batch_jobs[batch_id]
                job["image_step"] = "vision"
                job["step"] = "vision"

            result = await analyze_single_image(fd["bytes"], fd["filename"], rules)

            if batch_id and batch_id in _batch_jobs:
                job = _batch_jobs[batch_id]
                job["completed"] = job.get("completed", 0) + 1
                job["sub_progress"] = (job["completed"] / job["total"]) * 100
                progress = job["completed"] / job["total"]
                if progress < 0.3:
                    job["step"] = "vision"
                elif progress < 0.6:
                    job["step"] = "evaluating"
                elif progress < 0.9:
                    job["step"] = "cross_validation"
                else:
                    job["step"] = "building_report"

            return BatchImageResult(
                image_name=fd["filename"],
                verdict=result["verdict"],
                confidence=result["confidence"],
                violations=result.get("violations", []),
                passed_details=result.get("passed_details", []),
                image_url=result.get("image_url"),
                image_width=result.get("image_width"),
                image_height=result.get("image_height"),
                session_id=result.get("session_id"),
                summary=result.get("summary"),
                content_type_detected=result.get("content_type_detected"),
                background_type_detected=result.get("background_type_detected"),
            )
        except Exception as e:
            logger.error("Batch item error for %s: %s", fd["filename"], e)
            if batch_id and batch_id in _batch_jobs:
                _batch_jobs[batch_id]["completed"] = _batch_jobs[batch_id].get("completed", 0) + 1
            return BatchImageResult(
                image_name=fd["filename"],
                verdict="WARNING",
                confidence=0,
                error=str(e),
            )

    return list(await asyncio.gather(*[process_one(fd, i) for i, fd in enumerate(file_data)]))


async def _persist_batch(batch_id: str, batch_result: BatchResult, summary: BatchSummary):
    pool = await database.get_pool()
    if pool:
        try:
            analysis_ids = []
            async with pool.acquire() as conn:
                for r in batch_result.results:
                    if r.session_id:
                        row = await conn.fetchrow(
                            "SELECT a.id FROM analyses a JOIN chat_sessions cs ON cs.analysis_id = a.id WHERE cs.session_id = $1",
                            r.session_id,
                        )
                        if row:
                            analysis_ids.append(row["id"])
                await conn.execute(
                    "INSERT INTO batches (batch_id, analysis_ids, summary_json) VALUES ($1, $2, $3::jsonb)",
                    batch_id, analysis_ids, json.dumps(summary.model_dump()),
                )
                if analysis_ids:
                    await conn.execute(
                        "UPDATE analyses SET batch_id = $1 WHERE id = ANY($2::int[])",
                        batch_id, analysis_ids,
                    )
        except Exception as e:
            logger.error("Batch DB insert error: %s", e)

    await redis_client.cache_set(f"batch:{batch_id}", batch_result.model_dump(), ttl=86400)
