import json
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import settings
from backend import database, redis_client
from backend.routers import compliance, batch, rules, history, chat


@asynccontextmanager
async def lifespan(app: FastAPI):
    rules_path = settings.rules_file_path
    if not os.path.isabs(rules_path):
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        rules_path = os.path.join(base, rules_path)
        rules_path = os.path.normpath(rules_path)

    try:
        with open(rules_path, "r") as f:
            app.state.rules = json.load(f)
        print(f"Rules loaded from {rules_path}")
    except FileNotFoundError:
        local_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "rules.json")
        try:
            with open(local_path, "r") as f:
                app.state.rules = json.load(f)
            print(f"Rules loaded from {local_path}")
        except Exception as e:
            app.state.rules = {}
            print(f"Warning: Could not load rules file: {e}")

    await redis_client.cache_rules(app.state.rules)
    await database.init_db()

    yield

    await database.close_pool()


app = FastAPI(
    title="AI Marketing Compliance Engine",
    description="Evaluate marketing images against brand compliance rules using Azure AI",
    version="1.0.0",
    lifespan=lifespan,
)

_cors_origins = (
    settings.cors_allowed_origins.split(",")
    if settings.cors_allowed_origins
    else ["*"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(compliance.router)
app.include_router(batch.router)
app.include_router(rules.router)
app.include_router(history.router)
app.include_router(chat.router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "rules_loaded": bool(getattr(app.state, "rules", {})),
        "azure_openai_configured": bool(settings.azure_openai_endpoint),
        "azure_vision_configured": bool(settings.azure_vision_endpoint),
        "azure_blob_configured": bool(settings.azure_blob_connection_string),
        "postgres_configured": bool(settings.database_url),
        "redis_configured": bool(settings.upstash_redis_url),
    }
