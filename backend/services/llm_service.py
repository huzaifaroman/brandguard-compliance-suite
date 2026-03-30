import asyncio
import json
import logging
from typing import Optional, AsyncIterator

from openai import AzureOpenAI
from openai.types.chat import (
    ChatCompletionSystemMessageParam,
    ChatCompletionUserMessageParam,
)

from backend.config import settings

logger = logging.getLogger("backend.services.llm")

LLM_TIMEOUT_SECONDS = 60

_client = None


def _get_client() -> AzureOpenAI:
    global _client
    if _client is None:
        if not settings.azure_openai_endpoint or not settings.azure_openai_key:
            raise RuntimeError("Azure OpenAI credentials not configured")
        _client = AzureOpenAI(
            api_version=settings.azure_openai_api_version,
            azure_endpoint=settings.azure_openai_endpoint,
            api_key=settings.azure_openai_key,
        )
    return _client


SYSTEM_PROMPT = """You are a ZONNIC brand compliance analyst. You evaluate marketing images against the ZONNIC Design Guidelines.

You will receive:
1. RULES: The complete brand guidelines as structured JSON
2. VISION_SIGNALS: Visual analysis data extracted from the uploaded image
3. USER_PROMPT: Optional additional question from the user

VISION API CAPABILITIES — READ CAREFULLY:
The vision signals come from Azure Vision Image Analysis 4.0. Here is what it CAN and CANNOT detect:

CAN detect:
- OCR text (exact words, positions, bounding polygons, confidence scores)
- Image captions and dense captions describing visible content
- Object detection (people, items) with bounding boxes
- Tags (scene-level labels like "person", "clothing", "outdoor")

CANNOT detect (these signals are NOT available):
- Exact colours/hex values of text, backgrounds, or elements (NO color_analysis)
- Shape detection — circles, halos, geometric shapes (NO shape_detection)
- Font names or font weights (NO font_analysis)
- Background classification — gradient vs solid vs image (NO background_classification)
- Color gradients, opacity levels (NO color_gradient_analysis)
- Spatial relationships like "safety zone" measurements (NO spatial_analysis)

CRITICAL EVALUATION RULES:

1. NEVER flag a violation for something the vision signals CANNOT verify.
   - If a check requires "color_analysis" or "shape_detection" and those signals are not present, you CANNOT determine compliance. Report the check as PASSED with detail "Unable to verify from available signals — requires manual review" rather than flagging a violation you have NO evidence for.
   - Example: You CANNOT say "logo text is not navy blue" because you have NO colour data. Instead, report it as passed with note that colour verification requires manual review.

2. ONLY flag violations when you have POSITIVE EVIDENCE of a problem:
   - OCR text is PRESENT but shows wrong content → violation
   - OCR text is ABSENT when it should be present (e.g., no nicotine warning detected) → violation
   - Caption/tags show prohibited content (e.g., person under 25 appearing) → violation
   - Object detected in wrong position → violation

3. "Absence of confirming evidence" is NOT the same as "evidence of a violation":
   - If OCR detects "ZONNIC" text → the logo IS present (PASS for LOGO-01)
   - If you can't see the C halo in vision signals → that does NOT mean it's missing. Vision API cannot detect shapes. Report as "Unable to verify — shape detection not available"
   - If you can't determine text colour → that does NOT mean the colour is wrong. Report as "Unable to verify — colour analysis not available"

YOUR TASK:
- Follow the ai_evaluation_checklist in EXACT ORDER (CHECK-01 through CHECK-15)
- You MUST evaluate and report on ALL 15 checks — no skipping
- For each check, evaluate every rule_id listed in rules_to_evaluate
- Every rule_id must appear in EITHER violations OR passed_details — account for ALL rules

CLASSIFICATION:
- PASS: No violations found (unable-to-verify items do not count as violations)
- FAIL: One or more violations with POSITIVE EVIDENCE
- WARNING: Only medium severity issues or low-confidence detections

VIOLATION REQUIREMENTS (only when you have positive evidence):
- Cite the exact rule ID
- Include the rule text from the rules JSON
- Explain what's wrong with SPECIFIC evidence from vision signals
- Provide an actionable fix suggestion
- Include bounding box (x, y, w, h) when the violation relates to a detected element. Use null for missing elements.

PASSED_DETAILS REQUIREMENTS:
- For EVERY check (CHECK-01 through CHECK-15), report what you found
- For checks you CAN verify: explain exactly what was detected and why it passes
- For checks you CANNOT verify (missing signal type): report with detail "Unable to fully verify from available vision signals — [specific signal type] not available. Requires manual review."
- Be specific: "ZONNIC text detected via OCR at position (332,292) with 99.1% confidence — logo presence confirmed per LOGO-01"
- Group by category: Regulatory, Logo, Gradient, Colors, Typography, Content

BACKGROUND AND CONTENT TYPE DETECTION:
- Use captions, dense_captions, and tags to infer background and content type when possible
- If captions describe a person/model → likely brand_purpose or flavour_led content
- If captions describe products → likely flavour_led
- If background cannot be determined from captions/tags → use "unknown" but do NOT flag violations for it

Return ONLY valid JSON matching the schema below. No extra text."""

COMPLIANCE_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "compliance_result",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "verdict": {
                    "type": "string",
                    "enum": ["PASS", "FAIL", "WARNING"]
                },
                "confidence": {
                    "type": "integer",
                    "description": "0-100 confidence in the verdict"
                },
                "summary": {
                    "type": "string",
                    "description": "2-3 sentence summary of findings including what was verified and what requires manual review"
                },
                "checks_performed": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "check_id": {"type": "string", "description": "CHECK-01 through CHECK-15"},
                            "check_name": {"type": "string"},
                            "status": {"type": "string", "enum": ["pass", "fail", "manual_review"]},
                            "detail": {"type": "string", "description": "What was evaluated and the outcome"}
                        },
                        "required": ["check_id", "check_name", "status", "detail"],
                        "additionalProperties": False
                    },
                    "description": "All 15 checks from the evaluation checklist with their results"
                },
                "violations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "rule_id": {"type": "string"},
                            "rule_text": {"type": "string"},
                            "severity": {"type": "string", "enum": ["critical", "high", "medium"]},
                            "issue": {"type": "string"},
                            "fix_suggestion": {"type": "string"},
                            "evidence": {"type": "string"},
                            "bbox": {
                                "anyOf": [
                                    {
                                        "type": "object",
                                        "properties": {
                                            "x": {"type": "integer"},
                                            "y": {"type": "integer"},
                                            "w": {"type": "integer"},
                                            "h": {"type": "integer"}
                                        },
                                        "required": ["x", "y", "w", "h"],
                                        "additionalProperties": False
                                    },
                                    {"type": "null"}
                                ]
                            }
                        },
                        "required": ["rule_id", "rule_text", "severity", "issue", "fix_suggestion", "evidence", "bbox"],
                        "additionalProperties": False
                    }
                },
                "passed_details": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "rule_id": {"type": "string"},
                            "category": {
                                "type": "string",
                                "enum": ["Regulatory", "Logo", "Gradient", "Colors", "Typography", "Content"]
                            },
                            "detail": {
                                "type": "string",
                                "description": "What was detected and why it passes, or why it requires manual review"
                            },
                            "verified": {
                                "type": "boolean",
                                "description": "true if compliance was positively confirmed from signals, false if it requires manual review"
                            }
                        },
                        "required": ["rule_id", "category", "detail", "verified"],
                        "additionalProperties": False
                    },
                    "description": "All rules not in violations — either verified as passing or requiring manual review"
                },
                "content_type_detected": {
                    "type": "string",
                    "enum": ["flavour_led", "educational", "brand_purpose", "unknown"]
                },
                "background_type_detected": {
                    "type": "string",
                    "enum": ["gradient", "grey_gradient", "white", "light_image", "dark_image", "solid_color", "unknown"]
                }
            },
            "required": ["verdict", "confidence", "summary", "checks_performed", "violations", "passed_details", "content_type_detected", "background_type_detected"],
            "additionalProperties": False
        }
    }
}

CHAT_SYSTEM_PROMPT = """You are a ZONNIC brand compliance assistant. The user has already run a compliance check on a marketing image. You have access to the full analysis results including verdict, violations, checks passed, and detected content/background types.

Answer follow-up questions about:
- Why specific violations were flagged (reference the exact rule ID and rule text)
- How to fix compliance issues with actionable design guidance
- What the ZONNIC brand rules require (regulatory, logo, gradient, colour, content, typography)
- Detailed explanations of any check result from the ai_evaluation_checklist (CHECK-01 through CHECK-15)
- Bounding box locations and what was detected at those coordinates

Be concise, actionable, and always reference specific rule IDs (e.g. REG-01, LOGO-03, GRAD-02). If the user asks about something not covered in the analysis results, say so clearly and suggest running a new analysis if needed."""


def _build_compliance_message(vision_signals: dict, rules: dict, prompt: Optional[str]) -> str:
    user_prompt = prompt if prompt else "Check this image for brand compliance."
    return f"""RULES:
{json.dumps(rules, indent=2)}

VISION_SIGNALS:
{json.dumps(vision_signals, indent=2)}

USER_PROMPT: {user_prompt}"""


async def analyze_compliance(
    vision_signals: dict,
    rules: dict,
    prompt: Optional[str] = None,
) -> dict:
    if not settings.azure_openai_endpoint or not settings.azure_openai_key:
        logger.warning("Azure OpenAI not configured — returning placeholder")
        return _placeholder_result()

    try:
        client = _get_client()
        user_message = _build_compliance_message(vision_signals, rules, prompt)

        messages: list[ChatCompletionSystemMessageParam | ChatCompletionUserMessageParam] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ]

        response = await asyncio.wait_for(
            asyncio.to_thread(
                client.chat.completions.create,
                model=settings.azure_openai_deployment,
                temperature=0,
                top_p=0.1,
                seed=42,
                response_format=COMPLIANCE_SCHEMA,  # type: ignore[arg-type]
                messages=messages,
            ),
            timeout=LLM_TIMEOUT_SECONDS,
        )

        content = response.choices[0].message.content  # type: ignore[union-attr]
        if content is None:
            logger.error("GPT returned empty content")
            return _placeholder_result("AI returned empty response")

        result = json.loads(content)
        logger.info("GPT verdict: %s (%s%%)", result.get("verdict"), result.get("confidence"))
        return result

    except asyncio.TimeoutError:
        logger.error("Azure OpenAI request timed out")
        return _placeholder_result("Request timed out. Please try again.")
    except Exception as e:
        logger.error("Azure OpenAI error: %s: %s", type(e).__name__, e)
        return _placeholder_result(f"AI analysis failed: {type(e).__name__}")


async def chat_followup(
    session_id: str,
    compliance_result: dict,
    messages: list,
) -> AsyncIterator[str]:
    if not settings.azure_openai_endpoint or not settings.azure_openai_key:
        yield "Azure OpenAI is not configured. Add your credentials to enable the AI assistant."
        return

    try:
        client = _get_client()

        context_msg = f"COMPLIANCE ANALYSIS RESULTS:\n{json.dumps(compliance_result, indent=2)}"

        api_messages: list[ChatCompletionSystemMessageParam | ChatCompletionUserMessageParam] = [
            {"role": "system", "content": CHAT_SYSTEM_PROMPT},
            {"role": "system", "content": context_msg},
        ]
        for msg in messages:
            api_messages.append({"role": msg["role"], "content": msg["content"]})  # type: ignore[arg-type]

        stream = await asyncio.to_thread(
            client.chat.completions.create,
            model=settings.azure_openai_deployment,
            temperature=0.3,
            stream=True,
            messages=api_messages,
        )

        for chunk in stream:  # type: ignore[union-attr]
            if hasattr(chunk, "choices") and chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:  # type: ignore[union-attr]
                yield chunk.choices[0].delta.content  # type: ignore[union-attr]

    except Exception as e:
        logger.error("Chat followup error: %s: %s", type(e).__name__, e)
        yield f"Sorry, I encountered an error: {type(e).__name__}. Please try again."


def _placeholder_result(message: str = "") -> dict:
    summary = message or "Azure OpenAI not configured — placeholder result. Add credentials to enable real analysis."
    return {
        "verdict": "WARNING",
        "confidence": 0,
        "summary": summary,
        "checks_performed": [],
        "violations": [],
        "passed_details": [],
        "content_type_detected": "unknown",
        "background_type_detected": "unknown",
    }
