from fastapi import APIRouter, UploadFile, File, Form, Request, HTTPException
from typing import Optional

from backend.models.schemas import ComplianceResult
from backend.services.compliance_engine import analyze_single_image

router = APIRouter(prefix="/api", tags=["compliance"])

MAX_FILE_SIZE = 20 * 1024 * 1024
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


@router.post("/analyze", response_model=ComplianceResult)
async def analyze_image(
    request: Request,
    file: UploadFile = File(...),
    prompt: Optional[str] = Form(None),
):
    if file.content_type and file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {file.content_type}")

    file_bytes = await file.read()

    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 20MB)")

    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty file uploaded")

    rules = getattr(request.app.state, "rules", {})
    result = await analyze_single_image(file_bytes, file.filename or "image.png", rules, prompt)
    return result
