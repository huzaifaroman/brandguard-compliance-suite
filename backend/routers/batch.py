import asyncio
import uuid
import json
from fastapi import APIRouter, UploadFile, File, Request
from typing import List

from models.schemas import BatchResult, BatchSummary, BatchImageResult
from services.compliance_engine import analyze_single_image
import database

router = APIRouter(prefix="/api", tags=["batch"])

MAX_BATCH_SIZE = 10


@router.post("/batch", response_model=BatchResult)
async def batch_analyze(
    request: Request,
    files: List[UploadFile] = File(...),
):
    if len(files) > MAX_BATCH_SIZE:
        files = files[:MAX_BATCH_SIZE]

    rules = getattr(request.app.state, "rules", {})
    batch_id = str(uuid.uuid4())

    async def process_one(file: UploadFile) -> BatchImageResult:
        try:
            file_bytes = await file.read()
            result = await analyze_single_image(file_bytes, file.filename or "image.png", rules)
            return BatchImageResult(
                image_name=file.filename or "image.png",
                verdict=result["verdict"],
                confidence=result["confidence"],
                violations=result["violations"],
                checks_passed=result["checks_passed"],
                image_url=result.get("image_url"),
                image_width=result.get("image_width"),
                image_height=result.get("image_height"),
                session_id=result.get("session_id"),
            )
        except Exception as e:
            return BatchImageResult(
                image_name=file.filename or "image.png",
                verdict="FAIL",
                confidence=0,
                error=str(e),
            )

    results = await asyncio.gather(*[process_one(f) for f in files])

    summary = BatchSummary(
        passed=sum(1 for r in results if r.verdict == "PASS"),
        failed=sum(1 for r in results if r.verdict == "FAIL"),
        warnings=sum(1 for r in results if r.verdict == "WARNING"),
    )

    pool = await database.get_pool()
    if pool:
        analysis_ids = []
        async with pool.acquire() as conn:
            for r in results:
                if r.session_id:
                    row = await conn.fetchrow(
                        "SELECT id FROM analyses WHERE session_id = $1", r.session_id
                    )
                    if row:
                        analysis_ids.append(row["id"])
            await conn.execute(
                "INSERT INTO batches (batch_id, analysis_ids, summary_json) VALUES ($1, $2, $3::jsonb)",
                batch_id,
                analysis_ids,
                json.dumps(summary.model_dump()),
            )

    return BatchResult(
        batch_id=batch_id,
        total_images=len(results),
        summary=summary,
        results=list(results),
    )
