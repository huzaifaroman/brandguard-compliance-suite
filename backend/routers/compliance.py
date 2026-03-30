import asyncio
import json
import logging
import time

from fastapi import APIRouter, UploadFile, File, Form, Request, HTTPException
from fastapi.responses import StreamingResponse
from typing import Optional

from backend.models.schemas import ComplianceResult
from backend.services.compliance_engine import analyze_single_image, analyze_single_image_streaming
from backend.services.job_manager import create_job, get_job, run_job, cleanup_old_jobs

logger = logging.getLogger("backend.routers.compliance")

router = APIRouter(prefix="/api", tags=["compliance"])

MAX_FILE_SIZE = 20 * 1024 * 1024
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


def _validate_file(file_bytes: bytes, content_type: str | None):
    if content_type and content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {content_type}")
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file uploaded")


@router.post("/analyze", response_model=ComplianceResult)
async def analyze_image(
    request: Request,
    file: UploadFile = File(...),
    prompt: Optional[str] = Form(None),
):
    logger.info("Analyze: file=%s type=%s prompt=%s",
                file.filename, file.content_type,
                f"{len(prompt)} chars" if prompt else "none")

    file_bytes = await file.read()
    _validate_file(file_bytes, file.content_type)

    rules = getattr(request.app.state, "rules", {})
    start = time.time()
    result = await analyze_single_image(file_bytes, file.filename or "image.png", rules, prompt)
    elapsed = time.time() - start

    logger.info("Result: %s %s%% | %d violations | %.1fs | cached=%s",
                result.get("verdict"), result.get("confidence"),
                len(result.get("violations", [])), elapsed, result.get("cached"))
    return result


@router.post("/analyze/start")
async def start_analysis(
    request: Request,
    file: UploadFile = File(...),
    prompt: Optional[str] = Form(None),
):
    logger.info("Analyze (start): file=%s type=%s", file.filename, file.content_type)

    file_bytes = await file.read()
    _validate_file(file_bytes, file.content_type)

    rules = getattr(request.app.state, "rules", {})
    job_id = create_job(file_bytes, file.filename or "image.png", rules, prompt)

    asyncio.create_task(run_job(job_id))
    cleanup_old_jobs()

    logger.info("Job %s created for %s", job_id, file.filename)
    return {"job_id": job_id}


@router.get("/analyze/status/{job_id}")
async def get_analysis_status(job_id: str):
    status = get_job(job_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return status


@router.post("/analyze/stream")
async def analyze_image_stream(
    request: Request,
    file: UploadFile = File(...),
    prompt: Optional[str] = Form(None),
):
    logger.info("Analyze (stream): file=%s type=%s",
                file.filename, file.content_type)

    file_bytes = await file.read()
    _validate_file(file_bytes, file.content_type)

    rules = getattr(request.app.state, "rules", {})

    async def event_generator():
        start = time.time()
        try:
            async for event in analyze_single_image_streaming(
                file_bytes, file.filename or "image.png", rules, prompt
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            logger.error(f"Stream analysis error: {e}")
            yield f"data: {json.dumps({'event': 'error', 'message': str(e)})}\n\n"
        elapsed = time.time() - start
        logger.info("Stream analysis completed in %.1fs", elapsed)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
