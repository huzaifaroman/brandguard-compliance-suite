# BrandGuard AI Marketing Compliance Engine — Backend Pipeline (Detailed)

> **Purpose**: This document describes the complete backend pipeline of the BrandGuard Compliance Engine, built for ZONNIC brand (ITCAN). Use this to create a UML Activity Diagram covering every step, decision, and parallel flow.

---

## 1. SYSTEM OVERVIEW

**What it does**: Accepts a marketing image upload, runs it through a multi-stage AI pipeline (Azure Vision 4.0 + GPT-4.1), evaluates it against 62 ZONNIC brand compliance rules, and returns a structured Pass/Fail/Warning verdict with bounding boxes, fix suggestions, and evidence.

**Tech Stack**:
- **Framework**: FastAPI (Python) with Uvicorn (single worker)
- **AI Services**: Azure Vision 4.0 (Image Analysis), Azure OpenAI GPT-4.1
- **Storage**: Azure Blob Storage (images), Supabase PostgreSQL (results/history), Upstash Redis (caching)
- **Deployment**: Docker container on Azure Container Apps (nginx + supervisord)

---

## 2. ENTRY POINTS (Three Analysis Modes)

The frontend can invoke analysis via three different API endpoints:

### 2a. Synchronous Mode — `POST /api/analyze`
- Blocks until the full pipeline completes
- Returns the final `ComplianceResult` JSON directly
- Used for: quick/simple integrations

### 2b. Asynchronous (Polling) Mode — `POST /api/analyze/start` → `GET /api/analyze/status/{job_id}`
- `/api/analyze/start` accepts the image, creates a job in an in-memory dictionary (`_jobs`), launches the pipeline as a background `asyncio.Task`, and immediately returns a `job_id`
- The frontend polls `GET /api/analyze/status/{job_id}` every 1-2 seconds
- The job manager updates progress/step/message fields as the pipeline progresses
- When `status == "done"`, the response includes the full `result` object
- **Critical constraint**: Only 1 Uvicorn worker allowed — in-memory job state is per-process; 2+ workers cause 404s on status polls
- Used for: the primary frontend flow (with progress bar)

### 2c. Server-Sent Events (SSE) Streaming Mode — `POST /api/analyze/stream`
- Returns a `text/event-stream` response
- Yields `data: {json}\n\n` events at each pipeline stage
- Events include: `step` (progress updates) and `result` (final data)
- Used for: real-time streaming UIs

### 2d. Batch Mode — `POST /api/batch/analyze`
- Accepts up to 10 images
- Creates a `batch_id`, processes each image through the same single-image pipeline
- Stores batch summary in the `batches` table
- Returns aggregated results

---

## 3. FILE VALIDATION (All Modes)

Before any processing begins:

```
START → Receive uploaded file (multipart/form-data)
  │
  ├─ Check content_type ∈ {image/png, image/jpeg, image/webp, image/gif}
  │     └─ If unsupported → HTTP 400 "Unsupported file type"
  │
  ├─ Check file size ≤ 20MB
  │     └─ If too large → HTTP 400 "File too large"
  │
  ├─ Check file not empty
  │     └─ If empty → HTTP 400 "Empty file uploaded"
  │
  └─ Validation passed → Continue to pipeline
```

---

## 4. THE CORE PIPELINE (6 Stages)

Once validation passes, every analysis mode runs the same core pipeline via `analyze_single_image()` or `analyze_single_image_streaming()` in `compliance_engine.py`.

### Stage 1: IMAGE HASHING
- Compute SHA-256 hash of the raw image bytes
- This hash is used for:
  - Deduplication (cache key)
  - Blob storage filename prefix
  - Logging correlation (first 8 chars as `short_hash`)

### Stage 2: BLOB UPLOAD (Azure Blob Storage)
- **Service**: `blob_service.py`
- Extract image dimensions using Pillow (`PIL.Image`)
- Determine content type from file extension (png/jpg/webp/gif)
- Upload to Azure Blob Storage container (`compliance-images`)
  - Filename: `{hash_prefix_16}_{original_filename}`
  - Overwrites if exists
- Generate a SAS (Shared Access Signature) URL with 2-hour expiry for secure read access
- **Output**: `(blob_url, width, height)`
- If Azure Blob not configured → skip upload, still extract dimensions

### Stage 3: AZURE VISION ANALYSIS (Computer Vision 4.0)
- **Service**: `vision_service.py`
- Sends the raw image bytes to Azure Vision 4.0 Image Analysis API
- Requests 5 visual features simultaneously:
  1. **CAPTION** — single-sentence image description + confidence
  2. **DENSE_CAPTIONS** — multiple region-level captions with bounding boxes
  3. **TAGS** — semantic tags with confidence scores
  4. **OBJECTS** — detected objects with bounding boxes and tag labels
  5. **READ (OCR)** — all text in the image with word-level bounding polygons and confidence
- Retry logic: up to 2 attempts with 1-second backoff
- Timeout: 30 seconds per attempt
- **Output**: `vision_signals` dict containing all 5 feature results
- If Vision not configured → returns empty signals (pipeline continues with LLM only)

### Stage 4: LLM COMPLIANCE ANALYSIS (GPT-4.1 — Two-Pass Architecture)
- **Service**: `llm_service.py`
- This is the core intelligence of the system, using a **two-pass architecture**:

#### Pass 1: Brand Element Detection (`detect_brand_elements()`)
- **Purpose**: Carefully examine the image and extract a structured fact sheet of all ZONNIC brand elements present
- **Input to GPT-4.1**:
  - The actual image (base64-encoded, sent as vision content at "high" detail)
  - Official ZONNIC brand colour palettes (hardcoded reference)
  - The `vision_signals` from Stage 3 (OCR text, object labels, dense captions)
  - Pre-LLM heuristic: if a dense caption mentions "circle" near a "letter" and the bounding box is in the LEFT third of the logo area → inject a warning that this likely means a circle behind the Z letter
- **System Prompt**: Detailed instructions to examine logo presence/position/colour, halo analysis (which letters have circles behind them), background type, regulatory text, typography, colours, and content type
- **Structured Output** (JSON Schema enforced — `PASS1_SCHEMA`):
  ```
  {
    logo: { present, position, text_colour, distorted_or_modified, clear_space_sufficient, relative_size },
    halo: { any_halo_present, halo_on_z, halo_on_c, halo_on_other_letters, halo_colour, halo_is_gradient, halo_gradient_colours, halo_shape, halo_proportional, halo_has_outline, halo_outline_colour },
    background: { type, colours, gradient_direction, description },
    regulatory: { nicotine_warning_present, nicotine_warning_position, nicotine_warning_text, nicotine_warning_bilingual, age_icon_present, age_icon_position, risk_communication_present, risk_communication_position },
    typography: { fonts_visible, is_sans_serif, additional_text },
    colours: { dominant_colours, matches_flavour_palette, secondary_colour_usage },
    content_type: "flavour_led" | "educational" | "brand_purpose" | "logo_only" | "unknown",
    overall_description: "2-3 sentence description"
  }
  ```
- **LLM Settings**: temperature=0, max_tokens=4000, 180s timeout
- **Critical distinction**: If the only ZONNIC logo is on a physical product (tin/can), the logo and halo are pre-approved product packaging — not flagged as violations

#### Pass 2: Rule Evaluation (`evaluate_rules()`)
- **Purpose**: Evaluate every single one of the 62 brand rules against the detected brand elements
- **Input to GPT-4.1**:
  - The actual image (base64-encoded again at "high" detail)
  - The brand detection fact sheet from Pass 1 (formatted as readable text)
  - All 62 rules from `rules.json` (structured by category)
  - Image dimensions (for bounding box pixel coordinates)
  - Optional user prompt
- **System Prompt**: Exhaustive instructions covering:
  - 15-check evaluation checklist (CHECK-01 through CHECK-15)
  - Halo colour rules by background type (gradient bg → solid halo OK; white/grey bg → must be gradient)
  - Product packaging exceptions
  - Content type × background cross-checks
  - Violation detection for both "missing elements" and "present but wrong" categories
  - Verdict criteria (PASS/WARNING/FAIL)
  - Summary writing rules (no rule IDs, plain language for marketing teams)
- **Structured Output** (JSON Schema enforced — `PASS2_SCHEMA`):
  ```
  {
    verdict: "PASS" | "WARNING" | "FAIL",
    confidence: 0-100,
    summary: "4-6 sentence plain language assessment",
    checks_performed: [{ check_id, check_name, status, detail }],  // 15 checks
    violations: [{ rule_id, rule_text, severity, issue, fix_suggestion, evidence, bbox: {x,y,w,h} }],
    passed_details: [{ rule_id, category, detail, status: "pass"|"not_applicable" }],
    content_type_detected: "flavour_led"|"educational"|"brand_purpose"|"unknown",
    background_type_detected: "gradient"|"grey_gradient"|"white"|"light_image"|"dark_image"|"solid_colour"|"unknown"
  }
  ```
- **LLM Settings**: temperature=0, max_tokens=16000, 180s timeout
- Every violation MUST include a bounding box (pixel coordinates) — for missing elements, the bbox indicates WHERE the element SHOULD be placed

### Stage 5: POST-LLM CROSS-VALIDATION & CORRECTIONS
- **Purpose**: Programmatic safety net that catches cases where the LLM might have missed a violation that the Pass 1 detection facts clearly indicate
- **Service**: `_cross_validate_with_detection()` in `llm_service.py`

Checks performed (each forces a violation if Pass 1 facts show it but LLM didn't flag it):

| Detection Fact | Forced Violation |
|---|---|
| `halo_on_z == true` | LOGO-DONT-02 + LOGO-13 (halo on wrong letter + logo altered) |
| `halo_on_other_letters != "none"` | LOGO-DONT-11 + LOGO-13 |
| `halo_is_gradient == false` on white/grey background | LOGO-05 (should be gradient) |
| `nicotine_warning_present == false` | REG-01 (missing warning) |
| `age_icon_present == false` | REG-02 (missing 18+ icon) |
| `risk_communication_present == false` | REG-03 (missing risk text) |
| `distorted_or_modified == true` | LOGO-13 (logo altered) |
| `clear_space_sufficient == false` | LOGO-11 (insufficient clear space) |
| `halo_shape == "oval"/"distorted"` | LOGO-DONT-15 (not a perfect circle) |
| `halo_proportional == false` | LOGO-DONT-04 (disproportionate halo) |
| `halo_has_outline == true` | LOGO-DONT-03 (outline on halo) |
| `nicotine_warning_bilingual == false` | REG-05 (not bilingual) |
| `warning position != "top"` | REG-04 (wrong position) |
| `risk text position != "bottom"` | REG-04 (wrong position) |
| `logo colour wrong for background` | LOGO-06 or LOGO-10 |
| `secondary colour used as dominant` | COLOR-04 |

- When forcing violations: removes the rule from `passed_details`, adds to `violations`, and if verdict was PASS, downgrades to WARNING

### Stage 5b: EDUCATIONAL CONTENT SEVERITY ADJUSTMENT
- If content type is "educational" AND the logo is NOT present:
  - All logo-related violations (LOGO-*, LOGO-DONT-*) are downgraded from "critical" to "warning"
  - Rationale: Brand guidelines show approved educational assets without logos (e.g., testimonials)
  - Regulatory violations remain critical regardless

### Stage 5c: RULE COVERAGE VALIDATION
- **Service**: `_validate_rule_coverage()` in `llm_service.py`
- Ensures every one of the 62 rule IDs appears in either `violations` or `passed_details`
- If a rule ID appears in BOTH → removes from `passed_details` (violation takes precedence)
- If a rule ID appears in NEITHER → adds to `passed_details` as `status: "not_applicable"`
- Logs coverage stats

### Stage 5d: VERDICT RECALCULATION
- **Service**: `_recalculate_verdict()` in `compliance_engine.py`
- Overrides the LLM's verdict based on objective metrics:
  - **FAIL** if any critical regulatory violation (REG-01 through REG-05)
  - **PASS** if zero violations, OR pass_rate ≥ 95% with ≤ 2 violations and no critical regulatory
  - **WARNING** if pass_rate ≥ 85% with no critical regulatory
  - **FAIL** otherwise

### Stage 6: PERSIST & CACHE
- **Database** (Supabase PostgreSQL via asyncpg + pgBouncer pooler on port 6543):
  - Insert row into `analyses` table: image_hash, blob_url, dimensions, verdict, confidence, violations_json, passed_details_json, summary, content_type, background_type, session_id, timestamp
  - Insert row into `chat_sessions` table: links session_id to analysis_id for follow-up chat
  - Connection uses `statement_cache_size=0` for pgBouncer compatibility

- **Cache** (Upstash Redis):
  - Cache the full analysis result under key `analysis:{image_hash}` with 7-day TTL
  - Invalidate the history cache (`history:50:0`, `history:100:0`)

- **Debug File**: Raw API responses saved to `debug_raw_responses.json` (overwritten each time)

---

## 5. RESPONSE STRUCTURE

The final `ComplianceResult` returned to the frontend:

```json
{
  "image_url": "https://...blob.core.windows.net/...?sas_token",
  "image_width": 1200,
  "image_height": 800,
  "verdict": "PASS | WARNING | FAIL",
  "confidence": 98,
  "summary": "Plain language 4-6 sentence assessment for marketing teams...",
  "violations": [
    {
      "rule_id": "LOGO-05",
      "rule_text": "The C halo must be a gradient on white backgrounds...",
      "severity": "high",
      "issue": "The halo is a solid colour instead of gradient...",
      "fix_suggestion": "Apply a gradient using both primary and secondary palette colours...",
      "evidence": "The C halo appears as a single solid teal colour...",
      "bbox": { "x": 450, "y": 200, "w": 80, "h": 80 }
    }
  ],
  "passed_details": [
    {
      "rule_id": "REG-01",
      "category": "Regulatory",
      "detail": "Bilingual nicotine warning banner is present at the top of the image.",
      "status": "pass"
    }
  ],
  "checks_performed": [
    { "check_id": "CHECK-01", "check_name": "Regulatory Warnings", "status": "pass", "detail": "..." }
  ],
  "content_type_detected": "flavour_led",
  "background_type_detected": "gradient",
  "session_id": "uuid-for-follow-up-chat",
  "cached": false,
  "image_hash": "sha256..."
}
```

---

## 6. SUPPORTING FLOWS

### 6a. Follow-Up Chat — `POST /api/chat`
- After an analysis, users can ask follow-up questions
- Backend loads the compliance result context + chat history
- Streams GPT-4.1 responses via SSE
- Chat messages stored in `chat_messages` table + Redis cache (1-hour TTL)
- System prompt instructs the model to use friendly check names (not rule IDs)

### 6b. History — `GET /api/history`
- Returns past analyses from PostgreSQL (most recent first)
- Redis-cached with automatic invalidation when new analyses complete
- Returns: image_url (with fresh SAS token), verdict, confidence, timestamp, violation count

### 6c. Rules — `GET /api/rules`
- Returns the full 62-rule set from `rules.json`
- Organized by category: regulatory, logo, logo_donts, gradients, colours, content, typography

### 6d. Health Check — `GET /health`
- Returns service connectivity status for all 5 services
- Used by Azure Container Apps for health probes

---

## 7. THE 62 BRAND RULES (Organized by Category)

The rules are loaded from `backend/data/rules.json` at startup and organized into these categories:

| Category | Rule ID Prefix | Count | Examples |
|---|---|---|---|
| Regulatory | REG-01 to REG-05 | 5 | Nicotine warning banner, 18+ icon, risk communication, bilingual requirement |
| Logo Usage | LOGO-01 to LOGO-13 | 15 | Logo colour on backgrounds, minimum size, clear space, proper usage |
| Logo Don'ts | LOGO-DONT-01 to LOGO-DONT-15 | 15 | Don't add halo on Z, don't outline halo, don't distort, don't recolour |
| Logo Don'ts (Gradients/BGs) | LOGO-DONT-GRAD | 8 | Halo colour rules per background type |
| Gradient Rules | GRAD-01 to GRAD-05 | 5 | Gradient direction, colour pairing, opacity |
| Colour Application | COLOR-01 to COLOR-04 | 4 | Primary/secondary usage, accent colours, flavour palette matching |
| Content Type | CONTENT-01 to CONTENT-03 | 3 | Flavour-led vs educational vs brand purpose requirements |
| Content Don'ts | CONTENT-DONT-01 to CONTENT-DONT-04 | 4 | Don't mix content types, don't use wrong background for content type |
| Typography | TYPO-01 to TYPO-03 | 3 | Santral font family, sans-serif requirement, hierarchy |

**Total: 62 compliance rules** (plus 3 brand colour palette entries = 65 displayed on frontend)

---

## 8. INFRASTRUCTURE & DEPLOYMENT DETAILS

### Application Architecture
```
[nginx :80] → reverse proxy
  ├─ /api/*    → [uvicorn :8000] (FastAPI, 1 worker)
  ├─ /*        → [next start :3000] (Next.js 15 production)
  └─ /health   → [uvicorn :8000]
```

### External Service Connections
```
FastAPI Backend
  ├─→ Azure Vision 4.0 (canadaeast) — image analysis + OCR
  ├─→ Azure OpenAI GPT-4.1 (deployment: gpt-4.1-compliance) — 2-pass LLM
  ├─→ Azure Blob Storage — image upload + SAS URLs
  ├─→ Supabase PostgreSQL (pgBouncer pooler, port 6543) — persistent storage
  └─→ Upstash Redis — caching layer (analysis results, history, chat, rules)
```

### Database Schema (4 Tables)
```sql
analyses         — id, image_hash, blob_url, dimensions, verdict, confidence,
                   violations_json, checks_passed, passed_details_json, summary,
                   content_type_detected, background_type_detected, prompt,
                   session_id, batch_id, timestamp

batches          — id, batch_id, analysis_ids[], summary_json, timestamp

chat_sessions    — id, session_id, analysis_id (FK→analyses), created_at

chat_messages    — id, session_id, role, content, message_type, timestamp
```

### Docker Container
- Base: `python:3.11-slim` + Node.js 20 (copied from build stage)
- Process manager: supervisord running 2 processes:
  - `uvicorn backend.main:app --workers 1 --host 0.0.0.0 --port 8000`
  - `node /app/frontend/node_modules/.bin/next start -p 3000`
- nginx as the public-facing reverse proxy on port 80

---

## 9. ACTIVITY DIAGRAM FLOW SUMMARY

```
[User Uploads Image]
        │
        ▼
[File Validation] ──(fail)──→ [HTTP 400 Error]
        │(pass)
        ▼
[Create Job / Start Pipeline]
        │
        ├──────────────────────────────┐
        ▼                              ▼
[Compute SHA-256 Hash]        [Frontend Polls Status]
        │                              │
        ▼                              │ (repeats every 1-2s)
[Upload to Azure Blob]                │
   └─ Extract dimensions              │
   └─ Generate SAS URL                │
        │                              │
        ▼                              │
[Azure Vision 4.0 Analysis]           │
   └─ Caption                         │
   └─ Dense Captions + BBoxes         │
   └─ Tags                            │
   └─ Objects + BBoxes                │
   └─ OCR Text + Word Polygons        │
        │                              │
        ▼                              │
[Pre-LLM Heuristic Check]            │
   └─ Check dense captions for        │
     "circle near letter" on left      │
     side → inject Z-halo warning      │
        │                              │
        ▼                              │
[GPT-4.1 Pass 1: Brand Detection]    │
   └─ Image + Vision Signals + Colours │
   └─ Returns structured fact sheet    │
   └─ Logo, Halo, Background, etc.    │
        │                              │
        ▼                              │
[GPT-4.1 Pass 2: Rule Evaluation]    │
   └─ Image + Detection Facts + Rules  │
   └─ Evaluates all 62 rules          │
   └─ Returns violations + passed      │
   └─ Bounding boxes for each          │
        │                              │
        ▼                              │
[Cross-Validation]                    │
   └─ Compare Pass 1 facts vs         │
     Pass 2 results                    │
   └─ Force missed violations          │
   └─ 16 programmatic checks           │
        │                              │
        ▼                              │
[Educational Content Adjustment]      │
   └─ If educational + no logo:        │
     downgrade logo violations         │
        │                              │
        ▼                              │
[Rule Coverage Validation]            │
   └─ Ensure all 62 rules accounted   │
   └─ Remove duplicates               │
   └─ Add missing as not_applicable    │
        │                              │
        ▼                              │
[Verdict Recalculation]               │
   └─ Override LLM verdict based on:   │
     - Critical regulatory violations  │
     - Pass rate percentage            │
     - Violation count                 │
        │                              │
        ├──────────────────────────────┐
        ▼                              ▼
[Save to PostgreSQL]          [Cache in Redis]
   └─ analyses table              └─ 7-day TTL
   └─ chat_sessions table         └─ Invalidate history
        │
        ▼
[Return ComplianceResult]
   └─ verdict, confidence, summary
   └─ violations[] with bboxes
   └─ passed_details[]
   └─ session_id for chat
        │
        ▼
[Frontend Receives & Renders Results]
        │
        ▼ (optional)
[User Asks Follow-Up Chat Question]
        │
        ▼
[GPT-4.1 Chat with Analysis Context]
   └─ Streamed SSE response
   └─ Stored in chat_messages table
```

---

## 10. KEY DESIGN DECISIONS & CONSTRAINTS

1. **Two-Pass LLM Architecture**: Pass 1 focuses purely on detection (what's there), Pass 2 focuses on evaluation (does it comply). This separation prevents the LLM from skipping detection details when rushing to evaluate rules.

2. **Cross-Validation Safety Net**: Even with careful prompting, LLMs occasionally miss violations. The programmatic cross-validation layer catches 16 critical violation types using Pass 1 detection facts as ground truth.

3. **Single Worker Constraint**: The job manager stores state in an in-memory Python dictionary. With 2+ workers, a job created in worker A might be polled from worker B, returning 404. This is why exactly 1 Uvicorn worker is mandatory.

4. **Structured Output Enforcement**: Both LLM passes use OpenAI's `response_format: json_schema` with `strict: True`, guaranteeing the response matches the exact schema every time.

5. **Bounding Boxes for Every Violation**: The LLM must provide pixel-coordinate bounding boxes — for present violations (where the problem is) AND for missing elements (where the element SHOULD be placed). This enables visual annotation on the frontend.

6. **pgBouncer Compatibility**: Supabase uses pgBouncer for connection pooling. asyncpg's prepared statement cache conflicts with pgBouncer's transaction mode, so `statement_cache_size=0` is required.

7. **SAS URLs**: Blob storage URLs are not publicly accessible. The backend generates time-limited SAS tokens (2-hour expiry) for each image URL returned to the frontend.
