import json
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from backend.logging_config import setup_logging
from backend.config import settings
from backend import database, redis_client
from backend.routers import compliance, batch, rules, history, chat
from backend.services.dns_helper import init_dns

setup_logging()
logger = logging.getLogger("backend.main")

init_dns()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting AI Marketing Compliance Engine")

    rules_path = settings.rules_file_path
    if not os.path.isabs(rules_path):
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        rules_path = os.path.join(base, rules_path)
        rules_path = os.path.normpath(rules_path)

    try:
        with open(rules_path, "r") as f:
            app.state.rules = json.load(f)
        rule_count = sum(len(v) if isinstance(v, list) else 1 for v in app.state.rules.values())
        logger.info("Rules loaded: %d rules from %s", rule_count, rules_path)
    except FileNotFoundError:
        local_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "rules.json")
        try:
            with open(local_path, "r") as f:
                app.state.rules = json.load(f)
            rule_count = sum(len(v) if isinstance(v, list) else 1 for v in app.state.rules.values())
            logger.info("Rules loaded: %d rules from %s", rule_count, local_path)
        except Exception as e:
            app.state.rules = {}
            logger.warning("Could not load rules file: %s", e)

    await redis_client.cache_rules(app.state.rules)
    await database.init_db()

    svc = []
    if settings.azure_openai_endpoint:
        svc.append("Azure OpenAI")
    if settings.azure_vision_endpoint:
        svc.append("Azure Vision")
    if settings.azure_blob_connection_string:
        svc.append("Azure Blob")
    if settings.database_url:
        svc.append("PostgreSQL")
    if settings.upstash_redis_url:
        svc.append("Redis")
    logger.info("Services connected: %s", ", ".join(svc) if svc else "none")
    logger.info("Server ready — listening on port 8000")

    yield

    logger.info("Shutting down — closing connections")
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
    else []
)
if not _cors_origins:
    _cors_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

req_logger = logging.getLogger("backend.http")

class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path == "/health":
            return await call_next(request)

        method = request.method
        start = time.time()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            return response
        except Exception:
            raise
        finally:
            ms = (time.time() - start) * 1000
            if status < 300:
                color = "\033[32m"
            elif status < 400:
                color = "\033[33m"
            else:
                color = "\033[31m"
            req_logger.info(
                "%s %s → %s%d\033[0m  %.0fms",
                method, path, color, status, ms
            )

app.add_middleware(RequestLogMiddleware)

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
