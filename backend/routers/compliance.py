import logging
import time

from fastapi import APIRouter, UploadFile, File, Form, Request, HTTPException
from typing import Optional

from backend.models.schemas import ComplianceResult
from backend.services.compliance_engine import analyze_single_image

logger = logging.getLogger("backend.routers.compliance")

router = APIRouter(prefix="/api", tags=["compliance"])

MAX_FILE_SIZE = 20 * 1024 * 1024
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


@router.post("/analyze", response_model=ComplianceResult)
async def analyze_image(
    request: Request,
    file: UploadFile = File(...),
    prompt: Optional[str] = Form(None),
):
    logger.info("POST /api/analyze — file=%s size=%s type=%s prompt=%s",
                file.filename, file.size, file.content_type,
                repr(prompt[:80]) if prompt else "none")

    if file.content_type and file.content_type not in ALLOWED_TYPES:
        logger.warning("Rejected: unsupported file type %s", file.content_type)
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")

    file_bytes = await file.read()

    if len(file_bytes) > MAX_FILE_SIZE:
        logger.warning("Rejected: file too large (%d bytes)", len(file_bytes))
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")

    if len(file_bytes) == 0:
        logger.warning("Rejected: empty file")
        raise HTTPException(status_code=400, detail="Empty file uploaded")

    rules = getattr(request.app.state, "rules", {})
    start = time.time()
    result = await analyze_single_image(file_bytes, file.filename or "image.png", rules, prompt)
    elapsed = time.time() - start

    logger.info("Analysis complete — verdict=%s confidence=%s%% violations=%d time=%.1fs cached=%s",
                result.get("verdict"), result.get("confidence"),
                len(result.get("violations", [])), elapsed, result.get("cached"))
    return result
