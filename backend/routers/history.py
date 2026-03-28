from fastapi import APIRouter
from typing import List

from backend.models.schemas import HistoryResponse, HistoryItem
from backend import database

router = APIRouter(prefix="/api", tags=["history"])


@router.get("/history", response_model=HistoryResponse)
async def get_history(limit: int = 50, offset: int = 0):
    pool = await database.get_pool()
    if pool is None:
        return HistoryResponse(items=[], total=0)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, image_hash, blob_url, verdict, confidence,
                   jsonb_array_length(violations_json) as violations_count,
                   session_id, timestamp
            FROM analyses
            ORDER BY timestamp DESC
            LIMIT $1 OFFSET $2
            """,
            limit, offset,
        )
        total = await conn.fetchval("SELECT COUNT(*) FROM analyses")

    items = [
        HistoryItem(
            id=row["id"],
            image_hash=row["image_hash"],
            blob_url=row["blob_url"],
            verdict=row["verdict"],
            confidence=row["confidence"],
            violations_count=row["violations_count"] or 0,
            session_id=row["session_id"],
            timestamp=row["timestamp"],
        )
        for row in rows
    ]

    return HistoryResponse(items=items, total=total)
