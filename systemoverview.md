# AI Marketing Compliance Engine

## Overview
Evaluates marketing images against 62 ZONNIC brand compliance rules using a multi-step AI pipeline: Azure Computer Vision (Image Analysis 4.0) extracts visual signals → GPT-4.1 reasons about rule violations → structured Pass/Fail/Warning results with bounding boxes, confidence scores, and fix suggestions.

## Architecture
- **Backend**: FastAPI (Python 3.11) on port 8000
- **Frontend**: Next.js 15 (App Router, TypeScript, Turbopack) on port 5000 (webview)
- **AI Services**: Azure Computer Vision 4.0 + Azure OpenAI GPT-4.1
- **Storage**: Azure Blob Storage (images), PostgreSQL (analyses/history/chat), Upstash Redis (caching)
- **UI Framework**: shadcn/ui + Tailwind CSS + Framer Motion + Recharts, premium dark-first theme with aurora animated background, glassmorphism cards, gradient text headings, light mode toggle

## Project Structure
```
backend/
  main.py              # FastAPI app, CORS, lifespan (loads rules, init DB/Redis)
  config.py            # pydantic-settings (reads env vars)
  database.py          # asyncpg pool, schema migration (analyses, batches, chat_sessions, chat_messages)
  redis_client.py      # Upstash Redis async cache (analysis, rules, chat, history, batch)
  data/rules.json      # ZONNIC brand rules (62 rules, 10 categories + checklist)
  models/schemas.py    # Pydantic models (ComplianceResult, Violation with bbox/evidence/fix_suggestion, PassedDetail with rule_id/category/detail/status where status is "pass"|"not_applicable")
  routers/
    compliance.py      # POST /api/analyze — single image analysis (20MB limit, MIME validation)
    batch.py           # POST /api/batch — parallel multi-image analysis (up to 10, per-file validation)
    rules.py           # GET /api/rules — returns loaded brand rules (Redis-cached)
    history.py         # GET /api/history — paginated analysis audit log (Redis-cached); GET /api/analysis/{session_id} — full analysis detail retrieval
    chat.py            # GET/POST /api/chat/{session_id} — streaming AI chat follow-up (error handling)
  services/
    vision_service.py  # Azure Vision 4.0 (captions, dense_captions, tags, objects, OCR) with retries
    llm_service.py     # Two-pass GPT-4.1 analysis: Pass 1 = brand element detection (logo, halo, colours, regulatory), Pass 2 = rule evaluation against locked-in facts. Strict JSON schemas, temp=0, seed=42. Chat follow-up streaming.
    blob_service.py    # Azure Blob Storage upload with PIL dimensions
    compliance_engine.py # Orchestrates: hash → cache check → blob upload → vision → Pass 1 (detect) → Pass 2 (evaluate) → DB persist → cache
frontend/
  app/
    page.tsx           # Redirects to /analyze
    analyze/page.tsx   # Drag-drop upload, Recharts radial confidence arc, bounding box SVG overlay, verdict with spring animation, chat panel with streaming
    batch/page.tsx     # Multi-image upload, Recharts donut chart summary, expandable results table, CSV/PDF export
    rules/page.tsx     # Categorized rule browser with search, severity badges, collapsible sections
    history/page.tsx   # Audit log with consistency verification, hash grouping, report ID links
    report/[sessionId]/page.tsx # Full compliance report with violations detail, passed checks, severity breakdown, AI chat, print support
    layout.tsx         # Root layout with sidebar, dark theme, TooltipProvider, ErrorBoundary
    globals.css        # Premium oklch dark/light theme, aurora orbs, glass utilities, gradient-text, glow animations, responsive mobile optimization, reduced-motion support
  components/
    AuroraBackground.tsx # Animated gradient orb background (CSS-only, dark mode only, mobile-optimized)
    ClientShell.tsx    # Client layout shell with aurora background layer + sidebar
    Sidebar.tsx        # Navigation with gradient text, theme toggle, service health indicators
    ThemeToggle.tsx     # Dark/light mode toggle
    ErrorBoundary.tsx   # React error boundary with retry button
    ui/                # shadcn/ui components (button, card, badge, progress, tabs, dialog, etc.)
  lib/
    api.ts             # Fetch-based API client (analyze, batch, rules, history, chat streaming via SSE)
    types.ts           # TypeScript interfaces (Violation, PassedDetail, ComplianceResult, ChatMessage, etc.)
    rule-names.ts      # Friendly name mapping for rule IDs → user-facing display names (shared across all pages)
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
- Rule IDs (LOGO-01, REG-01, etc.) are INTERNAL ONLY — never shown to end users. All user-facing surfaces use friendly check names from `frontend/lib/rule-names.ts`. LLM prompts explicitly instruct no rule IDs in summaries or chat responses.
- Bounding boxes are pixel coordinates from Azure Vision, rendered as SVG overlay on the image
- Chat sessions are linked to analysis records via chat_sessions table
- All timestamps use TIMESTAMPTZ (PostgreSQL) for timezone awareness
- Only successful analyses (confidence > 0) are cached to prevent error caching
- File validation enforced on both single and batch endpoints (20MB, MIME types)
- DB operations in chat/history have try/except with graceful degradation

## Frontend Features
- Recharts radial arc meter for confidence display on analyze page
- Recharts donut chart for batch summary (pass/fail/warning distribution)
- CSV and PDF export for batch results (jsPDF for PDF generation)
- Dark/light mode toggle in sidebar
- Framer Motion spring-physics animations on verdict badges and chat messages
- ErrorBoundary wrapping all page content
- Empty states on all pages
- Interactive bounding box overlay with hover cross-highlighting between violation list and image
