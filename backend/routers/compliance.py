from fastapi import APIRouter, UploadFile, File, Form, Request
from fastapi.responses import StreamingResponse
from typing import Optional

from models.schemas import ComplianceResult
from services.compliance_engine import analyze_single_image

router = APIRouter(prefix="/api", tags=["compliance"])


@router.post("/analyze", response_model=ComplianceResult)
async def analyze_image(
    request: Request,
    file: UploadFile = File(...),
    prompt: Optional[str] = Form(None),
):
    rules = getattr(request.app.state, "rules", {})
    file_bytes = await file.read()
    result = await analyze_single_image(file_bytes, file.filename or "image.png", rules, prompt)
    return result
