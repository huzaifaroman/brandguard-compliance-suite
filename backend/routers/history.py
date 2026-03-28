import logging
from fastapi import APIRouter
from backend.models.schemas import HistoryResponse, HistoryItem
from backend import database, redis_client

logger = logging.getLogger("backend.routers.history")

router = APIRouter(prefix="/api", tags=["history"])

HISTORY_CACHE_TTL = 60


@router.get("/history", response_model=HistoryResponse)
async def get_history(limit: int = 50, offset: int = 0):
    cache_key = f"history:{limit}:{offset}"
    cached = await redis_client.cache_get(cache_key)
    if cached:
        logger.info("History: cache hit, %d items", len(cached.get("items", [])))
        return HistoryResponse(**cached)

    pool = await database.get_pool()
    if pool is None:
        return HistoryResponse(items=[], total=0)

    try:
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
    except Exception as e:
        logger.error(f"History DB query error: {e}")
        return HistoryResponse(items=[], total=0)

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

    response = HistoryResponse(items=items, total=total)
    await redis_client.cache_set(cache_key, response.model_dump(mode="json"), ttl=HISTORY_CACHE_TTL)

    logger.info("History: %d items loaded (total %d)", len(items), total)
    return response
