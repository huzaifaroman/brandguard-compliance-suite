import asyncio
import uuid
import json
import logging
from fastapi import APIRouter, UploadFile, File, Request, HTTPException
from typing import List

from backend.models.schemas import BatchResult, BatchSummary, BatchImageResult
from backend.services.compliance_engine import analyze_single_image
from backend import database, redis_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["batch"])

MAX_BATCH_SIZE = 10
MAX_FILE_SIZE = 20 * 1024 * 1024
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


@router.post("/batch", response_model=BatchResult)
async def batch_analyze(
    request: Request,
    files: List[UploadFile] = File(...),
):
    if len(files) > MAX_BATCH_SIZE:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_BATCH_SIZE} files allowed")
    if len(files) == 0:
        raise HTTPException(status_code=400, detail="No files provided")

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
                violations=result.get("violations", []),
                checks_passed=result.get("checks_passed", []),
                image_url=result.get("image_url"),
                image_width=result.get("image_width"),
                image_height=result.get("image_height"),
                session_id=result.get("session_id"),
            )
        except Exception as e:
            logger.error(f"Batch item error for {file.filename}: {e}")
            return BatchImageResult(
                image_name=file.filename or "image.png",
                verdict="WARNING",
                confidence=0,
                error=str(e),
            )

    results = await asyncio.gather(*[process_one(f) for f in files])

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

    pool = await database.get_pool()
    if pool:
        try:
            analysis_ids = []
            async with pool.acquire() as conn:
                for r in results:
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
        except Exception as e:
            logger.error(f"Batch DB insert error: {e}")

    await redis_client.cache_set(f"batch:{batch_id}", batch_result.model_dump(), ttl=86400)

    return batch_result
