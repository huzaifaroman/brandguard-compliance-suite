# AI Marketing Compliance Engine

## Overview
Evaluates marketing images against brand compliance rules using a multi-step AI pipeline: Azure Computer Vision (Image Analysis 4.0) extracts visual signals → GPT-4.1 reasons about rule violations → structured Pass/Fail/Warning results with bounding boxes, confidence scores, and fix suggestions.

## Architecture
- **Backend**: FastAPI (Python 3.11) on port 8000
- **Frontend**: Next.js 15 (App Router, TypeScript) on port 3000
- **AI Services**: Azure Computer Vision 4.0 + Azure OpenAI GPT-4.1
- **Storage**: Azure Blob (images), PostgreSQL (analyses/history), Upstash Redis (caching)

## Project Structure
```
backend/
  main.py              # FastAPI app, CORS, lifespan
  config.py            # pydantic-settings, reads from .env
  database.py          # asyncpg pool, schema migration
  redis_client.py      # Upstash Redis async cache
  data/rules.json      # Brand compliance rules (user-provided)
  models/schemas.py    # Pydantic request/response models
  routers/             # API endpoints (compliance, batch, rules, history, chat)
  services/
    vision_service.py  # Azure Vision Image Analysis 4.0 integration
    llm_service.py     # Azure OpenAI GPT-4.1 compliance reasoning + chat followup
    blob_service.py    # Azure Blob Storage upload (stub)
    compliance_engine.py # Orchestrates full pipeline
frontend/
  app/                 # Next.js App Router pages (analyze, batch, rules, history)
  components/          # Sidebar, UI components (shadcn/ui)
  lib/                 # API client, TypeScript types
  next.config.ts       # Rewrites /api/* → backend:8000
```

## Environment Configuration
- Config via pydantic-settings (reads env vars, supports .env file)
- Key vars: AZURE_VISION_ENDPOINT, AZURE_VISION_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, AZURE_OPENAI_DEPLOYMENT, DATABASE_URL, UPSTASH_REDIS_URL, UPSTASH_REDIS_TOKEN, CORS_ALLOWED_ORIGINS
- Services gracefully degrade when credentials missing (return placeholder data)
- Redis uses upstash-redis package (HTTPS REST API, not standard redis protocol)

## Workflows
- **Backend API**: `uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000`
- **Start application**: `cd frontend && npm run dev` (port 3000)

## Implementation Status
- [x] Project scaffold (backend + frontend structure)
- [x] Azure Vision service (real Image Analysis 4.0 integration)
- [x] Azure OpenAI GPT-4.1 compliance reasoning (structured JSON output, deterministic, streaming chat)
- [ ] Azure Blob Storage upload
- [ ] Premium frontend UI (bounding boxes, confidence gauges, chat)
