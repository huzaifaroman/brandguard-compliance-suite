import logging

import asyncpg
from backend.config import settings

logger = logging.getLogger("backend.database")

_pool = None


async def get_pool():
    global _pool
    if _pool is None and settings.database_url:
        _pool = await asyncpg.create_pool(settings.database_url)
    return _pool


async def init_db():
    pool = await get_pool()
    if pool is None:
        logger.warning("No DATABASE_URL configured — skipping DB init")
        return

    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS analyses (
                id SERIAL PRIMARY KEY,
                image_hash TEXT NOT NULL,
                blob_url TEXT,
                image_width INTEGER,
                image_height INTEGER,
                verdict TEXT,
                confidence FLOAT,
                violations_json JSONB DEFAULT '[]',
                checks_passed INTEGER DEFAULT 0,
                prompt TEXT,
                session_id TEXT,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_analyses_hash ON analyses(image_hash)")
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS batches (
                id SERIAL PRIMARY KEY,
                batch_id TEXT UNIQUE NOT NULL,
                analysis_ids INTEGER[],
                summary_json JSONB DEFAULT '{}',
                timestamp TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_sessions (
                id SERIAL PRIMARY KEY,
                session_id TEXT UNIQUE NOT NULL,
                analysis_id INTEGER REFERENCES analyses(id),
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                message_type TEXT DEFAULT 'text',
                timestamp TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)")
    logger.info("Database initialized — 4 tables ready")


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
