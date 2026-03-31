import json
import logging
from fastapi import APIRouter, HTTPException
from backend.models.schemas import HistoryResponse, HistoryItem, ComplianceResult, Violation, PassedDetail
from backend import database, redis_client
from backend.services.blob_service import get_sas_url

logger = logging.getLogger("backend.routers.history")

router = APIRouter(prefix="/api", tags=["history"])

HISTORY_CACHE_TTL = 3600


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
            blob_url=get_sas_url(row["blob_url"]),
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


@router.get("/analysis/{session_id}")
async def get_analysis(session_id: str):
    pool = await database.get_pool()
    if pool is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT a.id, a.image_hash, a.blob_url, a.image_width, a.image_height,
                       a.verdict, a.confidence, a.violations_json, a.passed_details_json,
                       a.session_id, a.timestamp, a.prompt,
                       COALESCE(a.summary, '') as summary,
                       COALESCE(a.content_type_detected, 'unknown') as content_type_detected,
                       COALESCE(a.background_type_detected, 'unknown') as background_type_detected
                FROM analyses a
                WHERE a.session_id = $1
                """,
                session_id,
            )
    except Exception as e:
        logger.error(f"Analysis lookup error: {e}")
        raise HTTPException(status_code=500, detail="Database query error")

    if not row:
        raise HTTPException(status_code=404, detail="Analysis not found")

    try:
        violations_raw = row["violations_json"] or []
        if isinstance(violations_raw, str):
            violations_raw = json.loads(violations_raw)
        violations = []
        for v in violations_raw:
            try:
                violations.append(Violation(**v).model_dump() if isinstance(v, dict) else v)
            except Exception:
                violations.append(v if isinstance(v, dict) else {"rule_id": "unknown", "issue": str(v)})
    except Exception as e:
        logger.warning(f"Error parsing violations for session {session_id}: {e}")
        violations = []

    try:
        passed_raw = row["passed_details_json"] or []
        if isinstance(passed_raw, str):
            passed_raw = json.loads(passed_raw)
        passed_details = []
        for p in passed_raw:
            try:
                passed_details.append(PassedDetail(**p).model_dump() if isinstance(p, dict) else p)
            except Exception:
                passed_details.append(p if isinstance(p, dict) else {"rule_id": "unknown", "category": "Content", "detail": str(p)})
    except Exception as e:
        logger.warning(f"Error parsing passed_details for session {session_id}: {e}")
        passed_details = []

    return {
        "image_url": get_sas_url(row["blob_url"]),
        "image_width": row["image_width"],
        "image_height": row["image_height"],
        "verdict": row["verdict"] or "WARNING",
        "confidence": row["confidence"] or 0,
        "violations": violations,
        "passed_details": passed_details,
        "summary": row["summary"] or "",
        "content_type_detected": row["content_type_detected"] or "unknown",
        "background_type_detected": row["background_type_detected"] or "unknown",
        "session_id": row["session_id"],
        "cached": False,
        "image_hash": row["image_hash"],
        "timestamp": row["timestamp"].isoformat() if row["timestamp"] else None,
    }
