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

LLM_TIMEOUT_SECONDS = 180

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
            timeout=180,
            max_retries=1,
        )
    return _client


PASS1_SYSTEM_PROMPT = """You are a ZONNIC brand visual inspector. Your ONLY job is to carefully examine a marketing image and describe EXACTLY what you see — focusing on ZONNIC brand elements. Do NOT evaluate rules or compliance yet. Just report the facts.

You will receive:
1. THE IMAGE: The actual marketing image — look at it carefully
2. BRAND_REFERENCE: The official ZONNIC brand colours and flavour palettes for comparison
3. VISION_SIGNALS: Supplementary OCR text and object data from computer vision

IMPORTANT: You can SEE the image directly. Use it to describe every detail below. Be extremely precise about positions, colours, and elements.

Examine the image and report on ALL of the following. If something is not present, say "NOT PRESENT":

LOGO ANALYSIS:
- Is the ZONNIC logo visible? Describe its position (top/center/bottom, left/center/right)
- What colour is the logo text? (navy blue, white, other — describe exact colour)
- Is the logo distorted, stretched, or modified in any way?
- Is the logo placed inside any shape (circle, square, etc.)?
- Is there sufficient clear space around the logo?
- Estimate the logo size relative to the full image

C HALO ANALYSIS (MOST IMPORTANT — BE EXTREMELY DETAILED):
- The correct ZONNIC logo has "ZONNIC" spelled out. The letters from left to right are: Z-O-N-N-I-C
- IMPORTANT: The Z letter sits inside a navy blue FILLED circle — this is a DESIGN ELEMENT of the logo, NOT a halo. The Z appears as a white letter on a navy blue circular background. This filled circle is EXPECTED and correct.
- The HALO is a DIFFERENT element — it is a coloured ring/circle that goes AROUND a letter (not a filled background behind a letter). The halo should only appear around the C (last/rightmost letter).
- Look at EACH letter carefully. Which letter(s) have a coloured ring/halo AROUND them (not a filled background BEHIND them)?
- Specifically: Does the Z (first letter, leftmost) have a halo ring around it? Does the C (last letter, rightmost) have a halo ring around it? Does any other letter have a halo?
- If a halo exists: What colour is it? Is it a single solid colour or a gradient (two colours blending)?
- If a halo exists: Is it a perfect circle or distorted/oval?
- If a halo exists: Is it proportional to the letter or oversized/undersized?
- If a halo exists: Does it have an outline/stroke? What colour is the outline?

BACKGROUND ANALYSIS:
- What is the background type? (solid white, solid colour, gradient, image/photo, dark, light)
- If gradient: what colours? What direction (left-to-right, top-to-bottom)?
- If image/photo: describe what's shown (people, products, scenery)

REGULATORY TEXT ANALYSIS:
- Is there a nicotine warning statement? Where is it positioned? What does it say? Is it bilingual (English + French)?
- Is there an 18+ age restriction icon? Where?
- Is there risk communication text? Where (bottom of image)?

TYPOGRAPHY:
- What fonts are visible? Are they sans-serif?
- Any text besides the logo and regulatory text? What does it say?

COLOUR ANALYSIS:
- What are the dominant colours in the image?
- Do they match any ZONNIC flavour palette? (Grey/Neutral, Green/Mint, Blue)
- Is the secondary/accent colour used sparingly or as a dominant element?

CONTENT TYPE:
- Is this a flavour-led asset (focused on product/flavour)?
- Is this educational content (health/information focused)?
- Is this brand purpose content (lifestyle/brand story)?
- Or is it just the logo on a simple background?

Return ONLY valid JSON matching the schema. No extra text."""

PASS1_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "brand_detection",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "logo": {
                    "type": "object",
                    "properties": {
                        "present": {"type": "boolean"},
                        "position": {"type": "string"},
                        "text_colour": {"type": "string"},
                        "distorted_or_modified": {"type": "boolean"},
                        "inside_shape": {"type": "string"},
                        "clear_space_sufficient": {"type": "boolean"},
                        "relative_size": {"type": "string"}
                    },
                    "required": ["present", "position", "text_colour", "distorted_or_modified", "inside_shape", "clear_space_sufficient", "relative_size"],
                    "additionalProperties": False
                },
                "halo": {
                    "type": "object",
                    "properties": {
                        "any_halo_present": {"type": "boolean"},
                        "halo_on_z": {"type": "boolean", "description": "Is there a halo on the Z (first/leftmost letter)?"},
                        "halo_on_c": {"type": "boolean", "description": "Is there a halo on the C (last/rightmost letter)?"},
                        "halo_on_other_letters": {"type": "string", "description": "List any other letters with halos, or 'none'"},
                        "halo_colour": {"type": "string", "description": "Exact colour description of the halo"},
                        "halo_is_gradient": {"type": "boolean", "description": "Is the halo a gradient (two colours) or a single solid colour?"},
                        "halo_gradient_colours": {"type": "string", "description": "If gradient, describe the two colours. If solid, repeat the single colour."},
                        "halo_shape": {"type": "string", "description": "circle, oval, distorted, or not present"},
                        "halo_proportional": {"type": "boolean"},
                        "halo_has_outline": {"type": "boolean"},
                        "halo_outline_colour": {"type": "string"}
                    },
                    "required": ["any_halo_present", "halo_on_z", "halo_on_c", "halo_on_other_letters", "halo_colour", "halo_is_gradient", "halo_gradient_colours", "halo_shape", "halo_proportional", "halo_has_outline", "halo_outline_colour"],
                    "additionalProperties": False
                },
                "background": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": ["white", "solid_colour", "gradient", "light_image", "dark_image", "grey_gradient", "unknown"]},
                        "colours": {"type": "string"},
                        "gradient_direction": {"type": "string"},
                        "description": {"type": "string"}
                    },
                    "required": ["type", "colours", "gradient_direction", "description"],
                    "additionalProperties": False
                },
                "regulatory": {
                    "type": "object",
                    "properties": {
                        "nicotine_warning_present": {"type": "boolean"},
                        "nicotine_warning_position": {"type": "string"},
                        "nicotine_warning_text": {"type": "string"},
                        "nicotine_warning_bilingual": {"type": "boolean"},
                        "age_icon_present": {"type": "boolean"},
                        "age_icon_position": {"type": "string"},
                        "risk_communication_present": {"type": "boolean"},
                        "risk_communication_position": {"type": "string"}
                    },
                    "required": ["nicotine_warning_present", "nicotine_warning_position", "nicotine_warning_text", "nicotine_warning_bilingual", "age_icon_present", "age_icon_position", "risk_communication_present", "risk_communication_position"],
                    "additionalProperties": False
                },
                "typography": {
                    "type": "object",
                    "properties": {
                        "fonts_visible": {"type": "string"},
                        "is_sans_serif": {"type": "boolean"},
                        "additional_text": {"type": "string"}
                    },
                    "required": ["fonts_visible", "is_sans_serif", "additional_text"],
                    "additionalProperties": False
                },
                "colours": {
                    "type": "object",
                    "properties": {
                        "dominant_colours": {"type": "string"},
                        "matches_flavour_palette": {"type": "string", "description": "Which flavour palette it matches, or 'none/unclear'"},
                        "secondary_colour_usage": {"type": "string", "description": "Is secondary colour used sparingly as accent, or as a dominant element?"}
                    },
                    "required": ["dominant_colours", "matches_flavour_palette", "secondary_colour_usage"],
                    "additionalProperties": False
                },
                "content_type": {
                    "type": "string",
                    "enum": ["flavour_led", "educational", "brand_purpose", "logo_only", "unknown"]
                },
                "overall_description": {
                    "type": "string",
                    "description": "2-3 sentence plain English description of what the image shows"
                }
            },
            "required": ["logo", "halo", "background", "regulatory", "typography", "colours", "content_type", "overall_description"],
            "additionalProperties": False
        }
    }
}


PASS2_SYSTEM_PROMPT = """You are a ZONNIC brand compliance analyst. You evaluate marketing images against the ZONNIC Design Guidelines.

You will receive:
1. THE IMAGE: The actual marketing image (use it to verify anything)
2. BRAND_DETECTION: A verified fact sheet of what ZONNIC brand elements are present in the image — this was produced by a separate careful inspection. TRUST these facts. Do NOT contradict them.
3. RULES: The complete brand guidelines as structured JSON
4. USER_PROMPT: Optional additional question

YOUR TASK:
- Evaluate every rule in the RULES against the BRAND_DETECTION facts and the image
- Follow the ai_evaluation_checklist in EXACT ORDER (CHECK-01 through CHECK-15)
- You MUST evaluate ALL 15 checks, no skipping
- There are 62 rules total. Every rule_id must appear in EITHER violations OR passed_details
- Double-check: violations + passed_details must total 62

IMPORTANT BRAND DESIGN CONTEXT:
- The ZONNIC logo has a navy blue FILLED circle behind the Z letter — the Z appears as a white letter on a blue circular background. This is a DESIGN ELEMENT of the logo, NOT a halo. It is expected and correct.
- The HALO is a SEPARATE element — a coloured ring that goes AROUND the C letter (rightmost). The halo should ONLY be on the C.
- On white or grey backgrounds, the C halo MUST be a gradient (two colours), NOT a solid single colour.

USING THE BRAND_DETECTION FACTS:
- The brand detection has already identified which letter the halo is on, what colour it is, whether it's a gradient, etc.
- If brand detection says halo_on_z=true and halo_on_c=false → that means the halo is on the WRONG letter → VIOLATION of LOGO-DONT-02
- If brand detection says halo_is_gradient=false on a white background → VIOLATION of LOGO-05
- If brand detection says nicotine_warning_present=false → VIOLATION of REG-01
- Always cross-reference the detection facts with each rule. Do NOT override the detection facts with your own assumptions.

RULE STATUS — EVERY RULE MUST BE ONE OF THREE:
1. VIOLATION (in violations array): The rule is clearly broken based on the detection facts and image
2. PASS (in passed_details with status "pass"): The rule is met — confirmed by detection facts
3. NOT APPLICABLE (in passed_details with status "not_applicable"): The rule does not apply to this image type (e.g. "dark background rules" on a white background image)

CRITICAL: Do NOT mark a rule as "pass" if the detection facts show it fails. Trust the detection facts.

SUMMARY REQUIREMENTS (the "summary" field):
Write a 4-6 sentence detailed summary that a marketing team can understand at a glance:
- Sentence 1-2: Describe what brand elements are visible — the ZONNIC logo position, text colour, the navy blue filled circle behind the Z (this is a design element, NOT the halo), the C halo (colour, shape, whether it's a gradient or solid), and the background type/colour.
- Sentence 3-4: State what is CORRECT — which brand guidelines are properly followed.
- Sentence 5-6: State what is WRONG — list the specific violations found and why they fail.
- Be specific about colours, shapes, and positions. Do NOT be vague.

OVERALL VERDICT:
- PASS: No violations found
- FAIL: One or more violations found
- WARNING: Only medium severity issues or borderline cases

VIOLATION REQUIREMENTS:
- Cite the exact rule ID and include the rule text
- Explain what's wrong in plain language a marketing team can understand
- Provide an actionable fix suggestion
- Include bounding box (x, y, w, h) when relevant, null for missing elements

PASSED_DETAILS REQUIREMENTS:
- For rules that PASS: describe what was confirmed
- For rules that are NOT APPLICABLE: briefly explain why
- Group by category: Regulatory, Logo, Gradient, Colors, Typography, Content

LANGUAGE RULES:
- Write everything in plain, non-technical English for a marketing team
- NEVER use: "OCR", "Vision API", "Azure", "GPT", "AI model", "dense captions", "tags", "bounding polygon", "confidence score", "signal", "verified from signals", "image signals", "manual review needed", "brand detection"
- Instead use: "text found", "logo visible", "color matches", "element present", "the image shows", "not visible in the image"

Return ONLY valid JSON matching the schema. No extra text."""

PASS2_SCHEMA = {
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
                    "description": "4-6 sentence detailed summary. MUST include: (1) What brand elements are present — logo position, text colour, the navy blue filled circle behind the Z letter, C halo colour/shape/gradient status, background type. (2) What is correct — list specific passing elements. (3) What is wrong — list specific violations found. Write for a marketing team."
                },
                "checks_performed": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "check_id": {"type": "string", "description": "CHECK-01 through CHECK-15"},
                            "check_name": {"type": "string"},
                            "status": {"type": "string", "enum": ["pass", "fail", "not_applicable"]},
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
                                "description": "Plain language explanation of what was found or why the rule does not apply"
                            },
                            "status": {
                                "type": "string",
                                "enum": ["pass", "not_applicable"],
                                "description": "pass = rule is met and verified, not_applicable = rule does not apply to this image type"
                            }
                        },
                        "required": ["rule_id", "category", "detail", "status"],
                        "additionalProperties": False
                    },
                    "description": "All rules not in violations — either verified as passing or not applicable to this image"
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


def _build_user_content(text_message: str, image_bytes: Optional[bytes] = None) -> list | str:
    if not image_bytes:
        return text_message

    import base64
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    content_type = "image/png"
    if image_bytes[:3] == b'\xff\xd8\xff':
        content_type = "image/jpeg"
    elif image_bytes[:4] == b'RIFF':
        content_type = "image/webp"

    return [
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:{content_type};base64,{b64}",
                "detail": "high",
            },
        },
        {
            "type": "text",
            "text": text_message,
        },
    ]


async def detect_brand_elements(
    vision_signals: dict,
    brand_colors: dict,
    image_bytes: Optional[bytes] = None,
) -> dict:
    if not settings.azure_openai_endpoint or not settings.azure_openai_key:
        logger.warning("Azure OpenAI not configured — skipping brand detection")
        return {}

    try:
        client = _get_client()
        text_message = f"""════════════════════════════════════════════════════
OFFICIAL ZONNIC BRAND COLOURS (use these as reference when identifying colours)
════════════════════════════════════════════════════
{json.dumps(brand_colors, indent=2)}

════════════════════════════════════════════════════
SUPPLEMENTARY VISION DATA (OCR text positions, object labels from Azure Vision)
════════════════════════════════════════════════════
{json.dumps(vision_signals, indent=2)}

════════════════════════════════════════════════════
TASK: Examine the image carefully and report exactly what brand elements you see.
Focus on: logo presence/position, C halo (colour, gradient vs solid, shape),
background type/colours, regulatory text, typography, and overall colour palette.
════════════════════════════════════════════════════"""

        user_content = _build_user_content(text_message, image_bytes)

        messages: list = [
            {"role": "system", "content": PASS1_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]

        if image_bytes:
            logger.info("Pass 1 — Brand detection: sending image (%dKB)", len(image_bytes) // 1024)

        response = await asyncio.wait_for(
            asyncio.to_thread(
                client.chat.completions.create,
                model=settings.azure_openai_deployment,
                temperature=0,
                top_p=0.1,
                seed=42,
                response_format=PASS1_SCHEMA,
                messages=messages,
            ),
            timeout=LLM_TIMEOUT_SECONDS,
        )

        content = response.choices[0].message.content
        if content is None:
            logger.error("Pass 1 — GPT returned empty content")
            return {}

        result = json.loads(content)
        logger.info("Pass 1 — Brand detection complete: logo=%s, halo_on_c=%s, halo_on_z=%s, bg=%s",
                     result.get("logo", {}).get("present"),
                     result.get("halo", {}).get("halo_on_c"),
                     result.get("halo", {}).get("halo_on_z"),
                     result.get("background", {}).get("type"))
        return result

    except asyncio.TimeoutError:
        logger.error("Pass 1 — Brand detection timed out")
        return {}
    except Exception as e:
        logger.error("Pass 1 — Brand detection error: %s: %s", type(e).__name__, e)
        return {}


async def evaluate_compliance(
    brand_detection: dict,
    vision_signals: dict,
    rules: dict,
    prompt: Optional[str] = None,
    image_bytes: Optional[bytes] = None,
) -> dict:
    if not settings.azure_openai_endpoint or not settings.azure_openai_key:
        logger.warning("Azure OpenAI not configured — returning placeholder")
        return _placeholder_result()

    try:
        client = _get_client()
        user_prompt = prompt if prompt else "Check this image for brand compliance."

        detection_summary = _format_detection_summary(brand_detection)

        text_message = f"""════════════════════════════════════════════════════
VERIFIED BRAND ELEMENT DETECTION (from separate image inspection — TRUST THESE FACTS)
════════════════════════════════════════════════════
{detection_summary}

════════════════════════════════════════════════════
BRAND RULES TO EVALUATE (check every rule against the detection facts above)
════════════════════════════════════════════════════
{json.dumps(rules, indent=2)}

════════════════════════════════════════════════════
SUPPLEMENTARY VISION DATA (OCR text positions, object labels)
════════════════════════════════════════════════════
{json.dumps(vision_signals, indent=2)}

USER REQUEST: {user_prompt}"""

        user_content = _build_user_content(text_message, image_bytes)

        messages: list = [
            {"role": "system", "content": PASS2_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]

        if image_bytes:
            logger.info("Pass 2 — Rule evaluation: sending image (%dKB) + detection facts + rules", len(image_bytes) // 1024)

        response = await asyncio.wait_for(
            asyncio.to_thread(
                client.chat.completions.create,
                model=settings.azure_openai_deployment,
                temperature=0,
                top_p=0.1,
                seed=42,
                response_format=PASS2_SCHEMA,
                messages=messages,
            ),
            timeout=LLM_TIMEOUT_SECONDS,
        )

        content = response.choices[0].message.content
        if content is None:
            logger.error("Pass 2 — GPT returned empty content")
            return _placeholder_result("AI returned empty response")

        result = json.loads(content)
        logger.info("Pass 2 — Verdict: %s (%s%%), %d violations",
                     result.get("verdict"), result.get("confidence"), len(result.get("violations", [])))
        return result

    except asyncio.TimeoutError:
        logger.error("Pass 2 — Rule evaluation timed out")
        return _placeholder_result("Request timed out. Please try again.")
    except Exception as e:
        logger.error("Pass 2 — Rule evaluation error: %s: %s", type(e).__name__, e)
        return _placeholder_result(f"AI analysis failed: {type(e).__name__}")


def _format_detection_summary(detection: dict) -> str:
    if not detection:
        return "No brand detection data available."

    logo = detection.get("logo", {})
    halo = detection.get("halo", {})
    bg = detection.get("background", {})
    reg = detection.get("regulatory", {})
    typo = detection.get("typography", {})
    colours = detection.get("colours", {})
    content_type = detection.get("content_type", "unknown")
    desc = detection.get("overall_description", "")

    lines = []
    lines.append(f"OVERVIEW: {desc}")
    lines.append(f"CONTENT TYPE: {content_type}")
    lines.append("")

    lines.append("── LOGO ──")
    lines.append(f"  Present: {'YES' if logo.get('present') else 'NO'}")
    if logo.get("present"):
        lines.append(f"  Position: {logo.get('position', 'unknown')}")
        lines.append(f"  Text colour: {logo.get('text_colour', 'unknown')}")
        lines.append(f"  Distorted or modified: {'YES' if logo.get('distorted_or_modified') else 'NO'}")
        inside = logo.get("inside_shape", "none")
        if inside and inside.lower() not in ("none", "not present", "n/a", ""):
            lines.append(f"  Inside shape: {inside}")
        lines.append(f"  Clear space sufficient: {'YES' if logo.get('clear_space_sufficient') else 'NO'}")
        lines.append(f"  Relative size: {logo.get('relative_size', 'unknown')}")
    lines.append("")

    lines.append("── C HALO (CRITICAL) ──")
    lines.append(f"  Any halo present: {'YES' if halo.get('any_halo_present') else 'NO'}")
    if halo.get("any_halo_present"):
        halo_on_z = halo.get("halo_on_z", False)
        halo_on_c = halo.get("halo_on_c", False)
        lines.append(f"  Halo on Z (leftmost letter): {'YES ⚠ WRONG LETTER!' if halo_on_z else 'NO (correct)'}")
        lines.append(f"  Halo on C (rightmost letter): {'YES (correct)' if halo_on_c else 'NO ⚠ MISSING FROM C!'}")
        lines.append(f"  Halo on other letters: {halo.get('halo_on_other_letters', 'none')}")
        lines.append(f"  Halo colour: {halo.get('halo_colour', 'unknown')}")
        is_grad = halo.get("halo_is_gradient", False)
        lines.append(f"  Halo is gradient (two colours): {'YES' if is_grad else 'NO — solid single colour ⚠'}")
        lines.append(f"  Gradient colours: {halo.get('halo_gradient_colours', 'N/A')}")
        lines.append(f"  Shape: {halo.get('halo_shape', 'unknown')}")
        lines.append(f"  Proportional: {'YES' if halo.get('halo_proportional') else 'NO'}")
        lines.append(f"  Has outline: {'YES' if halo.get('halo_has_outline') else 'NO'}")
        if halo.get("halo_has_outline"):
            lines.append(f"  Outline colour: {halo.get('halo_outline_colour', 'unknown')}")
    else:
        lines.append("  ⚠ NO HALO DETECTED ON ANY LETTER — LOGO-DONT-01 VIOLATION")
    lines.append("")

    lines.append("── BACKGROUND ──")
    lines.append(f"  Type: {bg.get('type', 'unknown')}")
    lines.append(f"  Colours: {bg.get('colours', 'unknown')}")
    if bg.get("gradient_direction") and bg.get("gradient_direction") != "NOT PRESENT":
        lines.append(f"  Gradient direction: {bg.get('gradient_direction')}")
    lines.append(f"  Description: {bg.get('description', '')}")
    lines.append("")

    lines.append("── REGULATORY ELEMENTS ──")
    lines.append(f"  Nicotine warning: {'PRESENT' if reg.get('nicotine_warning_present') else 'NOT PRESENT ⚠'}")
    if reg.get("nicotine_warning_present"):
        lines.append(f"    Position: {reg.get('nicotine_warning_position', 'unknown')}")
        warning_text = reg.get("nicotine_warning_text", "")
        if warning_text and warning_text.upper() != "NOT PRESENT":
            lines.append(f"    Text: {warning_text}")
        lines.append(f"    Bilingual: {'YES' if reg.get('nicotine_warning_bilingual') else 'NO ⚠'}")
    lines.append(f"  18+ age icon: {'PRESENT' if reg.get('age_icon_present') else 'NOT PRESENT ⚠'}")
    if reg.get("age_icon_present"):
        lines.append(f"    Position: {reg.get('age_icon_position', 'unknown')}")
    lines.append(f"  Risk communication: {'PRESENT' if reg.get('risk_communication_present') else 'NOT PRESENT ⚠'}")
    if reg.get("risk_communication_present"):
        lines.append(f"    Position: {reg.get('risk_communication_position', 'unknown')}")
    lines.append("")

    lines.append("── TYPOGRAPHY ──")
    lines.append(f"  Fonts: {typo.get('fonts_visible', 'unknown')}")
    lines.append(f"  Sans-serif: {'YES' if typo.get('is_sans_serif') else 'NO'}")
    lines.append(f"  Additional text: {typo.get('additional_text', 'none')}")
    lines.append("")

    lines.append("── COLOURS ──")
    lines.append(f"  Dominant: {colours.get('dominant_colours', 'unknown')}")
    lines.append(f"  Flavour palette match: {colours.get('matches_flavour_palette', 'unknown')}")
    lines.append(f"  Secondary colour usage: {colours.get('secondary_colour_usage', 'unknown')}")

    return "\n".join(lines)


async def analyze_compliance(
    vision_signals: dict,
    rules: dict,
    prompt: Optional[str] = None,
    image_bytes: Optional[bytes] = None,
    progress_callback=None,
) -> dict:
    brand_colors = rules.get("brand_colors", {})

    if progress_callback:
        await progress_callback("detecting", 50, "Identifying brand elements in the image...")

    brand_detection = await detect_brand_elements(vision_signals, brand_colors, image_bytes)

    if progress_callback:
        halo_info = brand_detection.get("halo", {})
        logo_info = brand_detection.get("logo", {})
        msg_parts = []
        if logo_info.get("present"):
            msg_parts.append("Logo found")
        if halo_info.get("halo_on_c"):
            msg_parts.append("halo on C")
        elif halo_info.get("halo_on_z"):
            msg_parts.append("halo on Z (wrong letter!)")
        elif not halo_info.get("any_halo_present"):
            msg_parts.append("no halo found")
        detection_summary = ", ".join(msg_parts) if msg_parts else "Detection complete"
        await progress_callback("detecting", 65, f"Brand detection: {detection_summary}")

    if progress_callback:
        await progress_callback("evaluating", 70, "Evaluating against all brand rules...")

    result = await evaluate_compliance(brand_detection, vision_signals, rules, prompt, image_bytes)

    _enforce_detection_violations(result, brand_detection)
    _validate_rule_coverage(result, rules)

    result["_brand_detection"] = brand_detection

    return result


def _enforce_detection_violations(result: dict, detection: dict):
    if not detection:
        return

    halo = detection.get("halo", {})
    bg = detection.get("background", {})
    reg = detection.get("regulatory", {})
    logo = detection.get("logo", {})

    violation_ids = {v["rule_id"] for v in result.get("violations", []) if "rule_id" in v}

    forced_violations = []

    if halo.get("halo_on_z") is True:
        if "LOGO-DONT-02" not in violation_ids:
            logger.warning("CROSS-VALIDATION: Detection says halo_on_z=true but LLM passed LOGO-DONT-02 — forcing violation")
            forced_violations.append({
                "rule_id": "LOGO-DONT-02",
                "rule_text": "Don't add the halo on the Z instead of the C.",
                "severity": "critical",
                "issue": "The halo/circle is on the Z (first letter) instead of the C (last letter). Only the C should have a halo.",
                "fix_suggestion": "Move the halo from the Z to the C (the last letter in ZONNIC).",
                "evidence": "Brand detection confirmed halo is present on the Z letter.",
                "bbox": None,
            })

    if not halo.get("any_halo_present", True):
        if "LOGO-DONT-01" not in violation_ids:
            logger.warning("CROSS-VALIDATION: Detection says no halo present but LLM passed LOGO-DONT-01 — forcing violation")
            forced_violations.append({
                "rule_id": "LOGO-DONT-01",
                "rule_text": "Don't lose the C halo (logo without any halo on the C).",
                "severity": "critical",
                "issue": "The C halo is missing from the ZONNIC logo.",
                "fix_suggestion": "Add a circular halo around the letter C using the correct flavour gradient colours.",
                "evidence": "No halo was detected on any letter in the logo.",
                "bbox": None,
            })

    bg_type = bg.get("type", "")
    if bg_type in ("white", "grey_gradient", "solid_colour") and halo.get("any_halo_present") and not halo.get("halo_is_gradient", True):
        if "LOGO-05" not in violation_ids:
            halo_col = halo.get("halo_colour", "unknown colour")
            logger.warning("CROSS-VALIDATION: Solid halo on white/grey bg but LLM passed LOGO-05 — forcing violation")
            forced_violations.append({
                "rule_id": "LOGO-05",
                "rule_text": "On a white or grey gradient background, the C halo must always use the full gradient (primary + secondary colours).",
                "severity": "critical",
                "issue": f"The C halo is a solid {halo_col}, not a gradient. On white or grey backgrounds, the halo must use both the primary and secondary flavour colours as a visible gradient.",
                "fix_suggestion": "Replace the solid halo with a gradient using both the primary (dark) and secondary (light) flavour colours.",
                "evidence": f"Brand detection confirmed the halo is a single solid colour ({halo_col}) on a {bg_type} background.",
                "bbox": None,
            })

    if halo.get("halo_on_other_letters", "none").lower() not in ("none", "not present", ""):
        if "LOGO-DONT-11" not in violation_ids:
            other = halo.get("halo_on_other_letters", "")
            logger.warning("CROSS-VALIDATION: Halo on other letters '%s' but LLM passed LOGO-DONT-11 — forcing violation", other)
            forced_violations.append({
                "rule_id": "LOGO-DONT-11",
                "rule_text": "Don't outline other letters in the logo (only C gets the halo).",
                "severity": "high",
                "issue": f"Halo or outline detected on letters other than C: {other}.",
                "fix_suggestion": "Remove halos or outlines from all letters except C.",
                "evidence": f"Brand detection found halos/outlines on: {other}.",
                "bbox": None,
            })

    if not reg.get("nicotine_warning_present", True):
        if "REG-01" not in violation_ids:
            logger.warning("CROSS-VALIDATION: No nicotine warning detected but LLM passed REG-01 — forcing violation")
            forced_violations.append({
                "rule_id": "REG-01",
                "rule_text": "Every marketing asset MUST include a bilingual nicotine warning statement banner at the TOP of the creative.",
                "severity": "critical",
                "issue": "No nicotine warning statement is present at the top of the image.",
                "fix_suggestion": "Add a bilingual nicotine warning banner (English + French) at the top of the image.",
                "evidence": "No nicotine warning text was found anywhere in the image.",
                "bbox": None,
            })

    if not reg.get("age_icon_present", True):
        if "REG-02" not in violation_ids:
            logger.warning("CROSS-VALIDATION: No 18+ icon detected but LLM passed REG-02 — forcing violation")
            forced_violations.append({
                "rule_id": "REG-02",
                "rule_text": "The 18+ icon must be present on marketing materials to indicate age restriction.",
                "severity": "critical",
                "issue": "The 18+ age restriction icon is missing.",
                "fix_suggestion": "Add the 18+ age restriction icon to the image.",
                "evidence": "No 18+ icon was detected in the image.",
                "bbox": None,
            })

    if not reg.get("risk_communication_present", True):
        if "REG-03" not in violation_ids:
            logger.warning("CROSS-VALIDATION: No risk communication detected but LLM passed REG-03 — forcing violation")
            forced_violations.append({
                "rule_id": "REG-03",
                "rule_text": "Every marketing asset MUST include risk communication text at the BOTTOM of the creative.",
                "severity": "critical",
                "issue": "Risk communication text is missing from the bottom of the image.",
                "fix_suggestion": "Add risk communication text at the bottom of the image.",
                "evidence": "No risk communication text was found in the image.",
                "bbox": None,
            })

    if not logo.get("present", True):
        if "LOGO-DONT-01" not in violation_ids and "LOGO-01" not in violation_ids:
            logger.warning("CROSS-VALIDATION: No logo detected — this may not be a ZONNIC marketing asset")

    if forced_violations:
        forced_ids = {v["rule_id"] for v in forced_violations}
        result["passed_details"] = [p for p in result.get("passed_details", []) if p.get("rule_id") not in forced_ids]
        result["violations"].extend(forced_violations)
        logger.info("CROSS-VALIDATION: Forced %d violations from detection facts: %s",
                     len(forced_violations), [v["rule_id"] for v in forced_violations])
        if result.get("verdict") == "PASS":
            result["verdict"] = "FAIL"


def _validate_rule_coverage(result: dict, rules: dict):
    all_rule_ids = set()
    for section_key in ["regulatory_rules", "logo_rules", "logo_donts", "logo_donts_gradients_backgrounds",
                         "gradient_rules", "color_application_rules", "content_type_rules", "content_donts", "typography_rules"]:
        section = rules.get(section_key, [])
        if isinstance(section, list):
            for rule in section:
                rid = rule.get("id") or rule.get("rule_id")
                if rid:
                    all_rule_ids.add(rid)

    violation_ids = {v["rule_id"] for v in result.get("violations", []) if "rule_id" in v}
    passed_ids = {p["rule_id"] for p in result.get("passed_details", []) if "rule_id" in p}

    covered = violation_ids | passed_ids
    missing = all_rule_ids - covered
    duplicates = violation_ids & passed_ids

    if duplicates:
        logger.warning("Rule IDs in BOTH violations and passed_details (removing from passed): %s", duplicates)
        result["passed_details"] = [p for p in result["passed_details"] if p.get("rule_id") not in duplicates]

    if missing:
        logger.warning("Missing rule IDs from LLM output (adding as not_applicable): %s", missing)
        for rid in sorted(missing):
            result["passed_details"].append({
                "rule_id": rid,
                "category": "Content",
                "detail": "Rule was not evaluated by the model",
                "status": "not_applicable",
            })

    total = len(result.get("violations", [])) + len(result.get("passed_details", []))
    logger.info("Rule coverage: %d violations + %d passed/na = %d total (expected %d)",
                len(result.get("violations", [])), len(result.get("passed_details", [])),
                total, len(all_rule_ids))


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
            api_messages.append({"role": msg["role"], "content": msg["content"]})

        stream = await asyncio.to_thread(
            client.chat.completions.create,
            model=settings.azure_openai_deployment,
            temperature=0.3,
            stream=True,
            messages=api_messages,
        )

        for chunk in stream:
            if hasattr(chunk, "choices") and chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

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
