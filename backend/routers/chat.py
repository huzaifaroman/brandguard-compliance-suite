import json
import logging
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from typing import List

from backend.models.schemas import ChatMessage, ChatRequest
from backend.services.llm_service import chat_followup
from backend import database, redis_client

logger = logging.getLogger("backend.routers.chat")

router = APIRouter(prefix="/api", tags=["chat"])


@router.get("/chat/{session_id}/messages", response_model=List[ChatMessage])
async def get_messages(session_id: str):
    cached = await redis_client.get_cached_chat_messages(session_id)
    if cached:
        logger.info("Chat %s: cache hit, %d msgs", session_id[:8], len(cached))
        return cached

    pool = await database.get_pool()
    if pool is None:
        return []

    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT role, content, message_type, timestamp FROM chat_messages WHERE session_id = $1 ORDER BY timestamp",
                session_id,
            )
    except Exception as e:
        logger.error(f"Chat messages DB query error: {e}")
        return []

    return [
        ChatMessage(
            role=r["role"],
            content=r["content"],
            message_type=r["message_type"],
            timestamp=r["timestamp"],
        )
        for r in rows
    ]


@router.post("/chat/{session_id}/message")
async def send_message(session_id: str, body: ChatRequest):
    logger.info("Chat %s: message received (%d chars)", session_id[:8], len(body.message))
    pool = await database.get_pool()

    compliance_result = {}
    message_history = []

    if pool:
        try:
            async with pool.acquire() as conn:
                session_row = await conn.fetchrow(
                    "SELECT analysis_id FROM chat_sessions WHERE session_id = $1", session_id
                )
                if session_row:
                    analysis_row = await conn.fetchrow(
                        "SELECT verdict, confidence, violations_json FROM analyses WHERE id = $1",
                        session_row["analysis_id"],
                    )
                    if analysis_row:
                        compliance_result = {
                            "verdict": analysis_row["verdict"],
                            "confidence": analysis_row["confidence"],
                            "violations": analysis_row["violations_json"],
                        }

                msg_rows = await conn.fetch(
                    "SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY timestamp",
                    session_id,
                )
                message_history = [{"role": r["role"], "content": r["content"]} for r in msg_rows]
        except Exception as e:
            logger.error(f"Chat context DB error: {e}")

    message_history.append({"role": "user", "content": body.message})

    if pool:
        try:
            async with pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO chat_messages (session_id, role, content) VALUES ($1, $2, $3)",
                    session_id, "user", body.message,
                )
        except Exception as e:
            logger.error(f"Chat message insert error: {e}")

    async def stream_response():
        full_response = ""
        async for chunk in chat_followup(session_id, compliance_result, message_history):
            full_response += chunk
            yield f"data: {json.dumps({'content': chunk})}\n\n"

        if pool:
            try:
                async with pool.acquire() as conn:
                    await conn.execute(
                        "INSERT INTO chat_messages (session_id, role, content) VALUES ($1, $2, $3)",
                        session_id, "assistant", full_response,
                    )
            except Exception as e:
                logger.error(f"Chat assistant message insert error: {e}")

        await redis_client.cache_chat_messages(session_id, message_history + [
            {"role": "assistant", "content": full_response}
        ])

        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(stream_response(), media_type="text/event-stream")
