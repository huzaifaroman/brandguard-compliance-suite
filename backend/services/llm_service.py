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
1. RULES: The complete brand guidelines as structured JSON
2. VISION_SIGNALS: Visual analysis data extracted from the uploaded image (captions, OCR text, detected objects, tags, colors, bounding boxes)
3. USER_PROMPT: Optional additional question from the user

YOUR TASK:
- Compare every visual signal against every applicable rule
- Classify the image as PASS, FAIL, or WARNING
- PASS: No violations found
- FAIL: One or more critical/high severity violations
- WARNING: Only medium severity issues or uncertain detections
- For each violation found, cite the exact rule ID and explain what's wrong and how to fix it
- Be deterministic: same signals must always produce same result
- ONLY flag violations you have evidence for from the vision signals — never guess

CRITICAL CHECKS (check these FIRST):
- REG-01 to REG-05: Nicotine warning, 18+ icon, risk communication (legal requirements)
- LOGO rules: Text color vs background, C halo presence and correctness
- GRADIENT rules: Direction, 70/30 split, logo position
- CONTENT rules: Background type vs content type match

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

CHAT_SYSTEM_PROMPT = """You are a ZONNIC brand compliance assistant. The user has already run a compliance check on a marketing image. You have access to the analysis results.

Answer follow-up questions about:
- Why specific violations were flagged
- How to fix compliance issues
- What the brand rules require
- Detailed explanations of any check result

Be concise, actionable, and reference specific rule IDs when relevant. If the user asks about something not in the analysis, say so clearly."""


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
