import json
import logging
from typing import Optional

from upstash_redis.asyncio import Redis

from backend.config import settings

logger = logging.getLogger(__name__)

_client = None


async def get_client() -> Optional[Redis]:
    global _client
    if _client is None and settings.upstash_redis_url and settings.upstash_redis_token:
        try:
            _client = Redis(
                url=settings.upstash_redis_url,
                token=settings.upstash_redis_token,
            )
        except Exception as e:
            logger.error(f"Failed to initialize Upstash Redis client: {e}")
            return None
    return _client


async def cache_set(key: str, value, ttl: Optional[int] = None):
    client = await get_client()
    if client is None:
        return
    try:
        serialized = json.dumps(value)
        if ttl:
            await client.setex(key, ttl, serialized)
        else:
            await client.set(key, serialized)
    except Exception as e:
        logger.error(f"Redis cache_set error for key '{key}': {e}")


async def cache_get(key: str) -> Optional[dict]:
    client = await get_client()
    if client is None:
        return None
    try:
        data = await client.get(key)
        if data:
            return json.loads(data)
    except Exception as e:
        logger.error(f"Redis cache_get error for key '{key}': {e}")
    return None


async def cache_rules(rules: dict):
    await cache_set("rules:compliance", rules)


async def get_cached_rules() -> Optional[dict]:
    return await cache_get("rules:compliance")


async def cache_analysis(image_hash: str, result: dict):
    await cache_set(f"analysis:{image_hash}", result, ttl=86400 * 7)


async def get_cached_analysis(image_hash: str) -> Optional[dict]:
    return await cache_get(f"analysis:{image_hash}")


async def cache_chat_messages(session_id: str, messages: list):
    client = await get_client()
    if client is None:
        return
    try:
        await client.setex(f"chat:{session_id}:messages", 3600, json.dumps(messages))
    except Exception as e:
        logger.error(f"Redis cache_chat_messages error: {e}")


async def get_cached_chat_messages(session_id: str) -> Optional[list]:
    client = await get_client()
    if client is None:
        return None
    try:
        data = await client.get(f"chat:{session_id}:messages")
        if data:
            return json.loads(data)
    except Exception as e:
        logger.error(f"Redis get_cached_chat_messages error: {e}")
    return None
