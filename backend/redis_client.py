import json
from typing import Optional
import redis.asyncio as aioredis
from backend.config import settings

_client = None


async def get_client() -> Optional[aioredis.Redis]:
    global _client
    if _client is None and settings.upstash_redis_url:
        _client = aioredis.from_url(
            settings.upstash_redis_url,
            password=settings.upstash_redis_token,
            decode_responses=True,
            ssl=True,
        )
    return _client


async def cache_set(key: str, value: dict, ttl: Optional[int] = None):
    client = await get_client()
    if client is None:
        return
    serialized = json.dumps(value)
    if ttl:
        await client.setex(key, ttl, serialized)
    else:
        await client.set(key, serialized)


async def cache_get(key: str) -> Optional[dict]:
    client = await get_client()
    if client is None:
        return None
    data = await client.get(key)
    if data:
        return json.loads(data)
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
    await client.set(f"chat:{session_id}:messages", json.dumps(messages), ex=3600)


async def get_cached_chat_messages(session_id: str) -> Optional[list]:
    client = await get_client()
    if client is None:
        return None
    data = await client.get(f"chat:{session_id}:messages")
    if data:
        return json.loads(data)
    return None
