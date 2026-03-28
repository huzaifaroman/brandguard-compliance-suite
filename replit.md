# AI Marketing Compliance Engine

## Overview
Evaluates marketing images against 62 ZONNIC brand compliance rules using a multi-step AI pipeline: Azure Computer Vision (Image Analysis 4.0) extracts visual signals → GPT-4.1 reasons about rule violations → structured Pass/Fail/Warning results with bounding boxes, confidence scores, and fix suggestions.

## Architecture
- **Backend**: FastAPI (Python 3.11) on port 8000
- **Frontend**: Next.js 15 (App Router, TypeScript, Turbopack) on port 5000 (webview)
- **AI Services**: Azure Computer Vision 4.0 + Azure OpenAI GPT-4.1
- **Storage**: Azure Blob Storage (images), PostgreSQL (analyses/history/chat), Upstash Redis (caching)
- **UI Framework**: shadcn/ui + Tailwind CSS + Framer Motion, dark-first theme

## Project Structure
```
backend/
  main.py              # FastAPI app, CORS, lifespan (loads rules, init DB/Redis)
  config.py            # pydantic-settings (reads env vars)
  database.py          # asyncpg pool, schema migration (analyses, batches, chat_sessions, chat_messages)
  redis_client.py      # Upstash Redis async cache (analysis, rules, chat, history, batch)
  data/rules.json      # ZONNIC brand rules (62 rules, 10 categories + checklist)
  models/schemas.py    # Pydantic models (ComplianceResult, Violation with bbox/evidence/fix_suggestion)
  routers/
    compliance.py      # POST /api/analyze — single image analysis
    batch.py           # POST /api/batch — parallel multi-image analysis (up to 10)
    rules.py           # GET /api/rules — returns loaded brand rules (Redis-cached)
    history.py         # GET /api/history — paginated analysis audit log (Redis-cached)
    chat.py            # GET/POST /api/chat/{session_id} — streaming AI chat follow-up
  services/
    vision_service.py  # Azure Vision 4.0 (captions, dense_captions, tags, objects, OCR)
    llm_service.py     # GPT-4.1 compliance reasoning (strict JSON schema, temp=0, seed=42) + streaming chat
    blob_service.py    # Azure Blob Storage upload with PIL dimensions
    compliance_engine.py # Orchestrates: hash → cache check → blob upload → vision → LLM → DB persist → cache
frontend/
  app/
    page.tsx           # Redirects to /analyze
    analyze/page.tsx   # Hero feature: drag-drop, bounding box overlay, verdict banner, chat panel
    batch/page.tsx     # Multi-image upload, parallel analysis, summary dashboard
    rules/page.tsx     # Categorized rule browser with search, severity badges
    history/page.tsx   # Audit log with consistency verification, hash grouping
    layout.tsx         # Root layout with sidebar, dark theme, TooltipProvider
    globals.css        # Premium dark theme (oklch colors, glass utilities, brand colors)
  components/
    Sidebar.tsx        # Navigation with service health indicators (Vision, GPT, DB, Cache)
    ui/                # shadcn/ui components (button, card, badge, progress, tabs, etc.)
  lib/
    api.ts             # Fetch-based API client (analyze, batch, rules, history, chat streaming)
    types.ts           # TypeScript interfaces (Violation, ComplianceResult, ChatMessage, etc.)
  next.config.ts       # Rewrites /api/* → backend:8000, Azure Blob image remotePatterns
```

## Environment Configuration
- Config via pydantic-settings (reads env vars)
- Required: AZURE_VISION_ENDPOINT, AZURE_VISION_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY
- Optional: AZURE_OPENAI_DEPLOYMENT (default: gpt-4o), DATABASE_URL, UPSTASH_REDIS_URL, UPSTASH_REDIS_TOKEN, AZURE_BLOB_CONNECTION_STRING, CORS_ALLOWED_ORIGINS
- Services gracefully degrade when credentials missing (return placeholder data)
- Redis uses upstash-redis package (HTTPS REST API, not standard redis protocol)

## Workflows
- **Backend API**: `uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000` (console output)
- **Start application**: `cd frontend && npm run dev` (port 5000, webview)

## Redis Caching Strategy
- `analysis:{hash}` — 7 day TTL, cached compliance results by image SHA-256
- `rules:compliance` — no TTL, loaded rules
- `chat:{session_id}:messages` — 1 hour TTL, chat message history
- `history:{limit}:{offset}` — 60s TTL, paginated history responses
- `batch:{batch_id}` — 24 hour TTL, batch analysis results

## Key Design Decisions
- `checks_passed` is a `string[]` (list of rule IDs) from LLM, converted to count for DB storage
- Violation model includes: rule_id, rule_text, severity (critical/high/medium), issue, evidence, fix_suggestion, bbox
- Bounding boxes are pixel coordinates from Azure Vision, rendered as SVG overlay on the image
- Chat sessions are linked to analysis records via chat_sessions table
- All timestamps use TIMESTAMPTZ (PostgreSQL) for timezone awareness
