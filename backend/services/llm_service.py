import asyncio
import json
import logging
from typing import Optional, AsyncIterator

from openai import AzureOpenAI

from backend.config import settings

logger = logging.getLogger(__name__)

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
1. RULES: The complete brand guidelines as structured JSON, including brand_colors, regulatory_rules, logo_rules, logo_donts, gradient_rules, color_application_rules, content_type_rules, content_donts, typography_rules, and an ai_evaluation_checklist
2. VISION_SIGNALS: Visual analysis data extracted from the uploaded image (captions, dense_captions with bounding boxes, OCR text with bounding polygons, detected objects with bounding boxes, tags with confidence scores)
3. USER_PROMPT: Optional additional question from the user

YOUR TASK:
- Follow the ai_evaluation_checklist in the rules JSON in EXACT ORDER (CHECK-01 through CHECK-15). Each check specifies which rule IDs to evaluate and what signals to use.
- For each check, evaluate all listed rules_to_evaluate against the available vision signals
- Classify the image as PASS, FAIL, or WARNING:
  - PASS: No violations found across all checks
  - FAIL: One or more critical or high severity violations
  - WARNING: Only medium severity issues or uncertain detections (low confidence in vision signals)
- For each violation found:
  - Cite the exact rule ID (e.g. REG-01, LOGO-03, GRAD-02)
  - Include the rule text from the rules JSON
  - Explain what's wrong with specific evidence from vision signals
  - Provide an actionable fix suggestion
  - Include bounding box coordinates (x, y, w, h in pixels) when the violation relates to a visible element detected by vision. Use null when the violation is about something MISSING.
- Be deterministic: same vision signals + same rules must ALWAYS produce the same result
- ONLY flag violations you have evidence for from the vision signals — never guess or assume
- Use brand_colors data to validate colour compliance (navy_blue #242c65, white #FFFFFF, flavour palettes)
- Use logo_donts and content_donts as negative checks — flag if any "don't" condition is detected

EVALUATION ORDER (mandatory):
1. HIGHEST PRIORITY: CHECK-01 to CHECK-03 (regulatory/legal — nicotine warning, 18+ icon, risk communication)
2. HIGH PRIORITY: CHECK-04 to CHECK-07 (logo presence, text colour, C halo, logo integrity)
3. MEDIUM PRIORITY: CHECK-08 to CHECK-10 (background type, gradient compliance, content-background match)
4. STANDARD: CHECK-11 to CHECK-15 (colour palette, typography, grey gradient, safety zone, background don'ts)

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
                    "description": "2-3 sentence summary of findings"
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
                                "type": ["object", "null"],
                                "properties": {
                                    "x": {"type": "integer"},
                                    "y": {"type": "integer"},
                                    "w": {"type": "integer"},
                                    "h": {"type": "integer"}
                                },
                                "required": ["x", "y", "w", "h"],
                                "additionalProperties": False
                            }
                        },
                        "required": ["rule_id", "rule_text", "severity", "issue", "fix_suggestion", "evidence", "bbox"],
                        "additionalProperties": False
                    }
                },
                "checks_passed": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of rule IDs that passed"
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
            "required": ["verdict", "confidence", "summary", "violations", "checks_passed", "content_type_detected", "background_type_detected"],
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

        response = await asyncio.wait_for(
            asyncio.to_thread(
                client.chat.completions.create,
                model=settings.azure_openai_deployment,
                temperature=0,
                top_p=0.1,
                seed=42,
                response_format=COMPLIANCE_SCHEMA,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_message},
                ],
            ),
            timeout=LLM_TIMEOUT_SECONDS,
        )

        result = json.loads(response.choices[0].message.content)
        logger.info(f"GPT-4.1 verdict: {result.get('verdict')} (confidence: {result.get('confidence')}%)")
        return result

    except asyncio.TimeoutError:
        logger.error("Azure OpenAI request timed out")
        return _placeholder_result("Request timed out. Please try again.")
    except Exception as e:
        logger.error(f"Azure OpenAI error: {type(e).__name__}: {e}")
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

        api_messages = [
            {"role": "system", "content": CHAT_SYSTEM_PROMPT},
            {"role": "system", "content": context_msg},
        ]
        for msg in messages:
            api_messages.append({"role": msg["role"], "content": msg["content"]})

        response = await asyncio.to_thread(
            client.chat.completions.create,
            model=settings.azure_openai_deployment,
            temperature=0.3,
            stream=True,
            messages=api_messages,
        )

        for chunk in response:
            if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    except Exception as e:
        logger.error(f"Chat followup error: {type(e).__name__}: {e}")
        yield f"Sorry, I encountered an error: {type(e).__name__}. Please try again."


def _placeholder_result(message: str = "") -> dict:
    summary = message or "Azure OpenAI not configured — placeholder result. Add credentials to enable real analysis."
    return {
        "verdict": "WARNING",
        "confidence": 0,
        "summary": summary,
        "violations": [],
        "checks_passed": [],
        "content_type_detected": "unknown",
        "background_type_detected": "unknown",
    }
