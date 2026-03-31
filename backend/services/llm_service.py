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
- Is the logo distorted, stretched, or modified? Check for: STRETCHED, SQUASHED, SKEWED, ROTATED, structurally REARRANGED (e.g. stacking ZON/NIC). Also check: is there any filled circle or shape BEHIND any letter other than C? If yes, report distorted_or_modified=true.
- Is there sufficient clear space around the logo?
- Estimate the logo size relative to the full image

CRITICAL — PRODUCT PACKAGING:
If the image shows a PHOTOGRAPH of a physical ZONNIC product (tin, pouch, box), the logo and halo PRINTED ON THE PRODUCT PACKAGING must be evaluated with the SAME brand rules as any other logo. Product packaging is NOT exempt. Analyze the halo colour, gradient, shape, and letter positioning on product packaging exactly as you would for a standalone marketing logo.

HALO / CIRCLE ANALYSIS (MOST IMPORTANT — BE EXTREMELY DETAILED):

THE CORRECT ZONNIC LOGO looks like this:
- Six letters: Z-O-N-N-I-C (left to right)
- All letters are bold sans-serif navy blue
- ONLY the C (last letter, rightmost) has a circular shape sitting PARTIALLY BEHIND it — this is called the "halo"
- The Z, O, N, N, and I should have NO circle, ring, or shape behind them whatsoever — they are plain letters on the background with nothing behind them

YOUR TASK — examine EACH letter one by one from left to right.
IMPORTANT: Analyze ALL visible ZONNIC logos, including logos printed on physical product packaging (tin/can/box). Product packaging logos must be evaluated the same way.

1. Z (leftmost): Is there ANY circle, ring, or filled shape sitting BEHIND this letter? Look carefully at the area behind and around the Z. If there is a dark circle, navy circle, or any round shape behind it → report halo_on_z=true. The Z letter itself has sharp angular edges — that is the normal letter shape. But if there is a SEPARATE circular shape BEHIND the Z letter, that is wrong.
2. O: Any circle or shape behind it?
3. First N: Any circle or shape behind it?
4. Second N: Any circle or shape behind it?
5. I: Any circle or shape behind it?
6. C (rightmost): Does it have a circular halo partially behind it? This is the ONLY letter that should have one.

Report halo_on_other_letters with the name of ANY letter (other than C) that has a circle/shape behind it.

If a halo exists on the C:
- What colour is it? Look VERY carefully for gradients — even subtle ones count. A gradient means ANY visible transition between two shades or colours within the halo. On product packaging (tins/cans), the curved surface may make gradients appear more subtle, but if there is ANY variation in colour from one side of the halo to the other (e.g. darker green to lighter green, or dark teal blending to lighter mint), that IS a gradient — report halo_is_gradient=true. Only report halo_is_gradient=false if the halo is truly one uniform flat colour with zero variation.
- Is it a perfect circle or distorted/oval?
- Is it proportional to the letter or oversized/undersized?
- Does it have an outline/stroke? What colour is the outline?

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
                        "clear_space_sufficient": {"type": "boolean"},
                        "relative_size": {"type": "string"}
                    },
                    "required": ["present", "position", "text_colour", "distorted_or_modified", "clear_space_sufficient", "relative_size"],
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
- The correct ZONNIC logo: six bold navy blue letters Z-O-N-N-I-C with a circular halo sitting PARTIALLY BEHIND the C (last letter) only.
- NO other letter should have any circle, ring, or shape behind it. The Z, O, N, N, I are plain letters with nothing behind them.
- If brand detection reports a circle/shape behind the Z → flag LOGO-DONT-02 ("Don't add the halo on the Z instead of the C") AND LOGO-13 ("The logo should never be altered or recreated"). Trust brand detection — if halo_on_z=true, these are violations.
- If brand detection reports a circle/shape behind any other letter (O, N, I) → flag LOGO-DONT-11 AND LOGO-13.
- The halo behind the C should be a gradient (two colours) on white/grey backgrounds, or a solid colour matching the flavour on gradient/coloured backgrounds.
- The HALO is a coloured ring that goes AROUND the C letter (rightmost). The halo should ONLY be on the C. No other letter has any circle or shape around it.
- On white or grey backgrounds, the C halo MUST be a gradient (two colours), NOT a solid single colour.

ASSETS IN PRACTICE — CONTENT TYPE vs BACKGROUND (critical cross-check):
First classify the content type, then verify the background AND logo requirements match:

1. FLAVOUR-LED content (product shots, flavour profiles, flavour-focused messaging):
   - Background MUST be primary flavour colour (1) or full gradient (1 & 2)
   - DON'T use solid white background for flavour-led visuals (GRAD-DONT-07)
   - Secondary colour only as accent, NEVER as full background (COLOR-04, GRAD-DONT-04)
   - Logo and halo ARE required

2. EDUCATIONAL content (testimonials, health info, how-to-use, convenience messaging, person with quote):
   - Background MUST be grey (signature grey gradient at 50% opacity on white)
   - Secondary colours used ONLY as accents/highlights, not dominant
   - DON'T use gradient backgrounds for educational content (GRAD-DONT-05)
   - CRITICAL EXCEPTION: Educational/testimonial assets MAY legitimately NOT include the ZONNIC logo or C halo. The brand guidelines show approved educational assets without any logo (e.g. testimonials with person photos and quotes). If the logo is missing from educational content, ALL logo-related rules (LOGO-01 through LOGO-13, LOGO-DONT-01 through LOGO-DONT-11) should be severity "warning" NOT "critical". Mark them as warnings with a note like "Logo is not present, which is acceptable for educational content but recommended for brand consistency."
   - Regulatory elements (18+ icon, nicotine warning, risk text) are ALWAYS required regardless — these remain critical.

3. BRAND PURPOSE content (lifestyle, brand story, awareness):
   - Background should be grey & white, properly laid out
   - DON'T use gradient backgrounds for brand purpose content (GRAD-DONT-05)
   - Logo IS required for brand purpose content

VIOLATION DETECTION — TWO CATEGORIES:
A) MISSING ELEMENTS (something required is not there):
   - No nicotine warning, no 18+ icon, no risk text, no halo on C, etc.
B) PRESENT BUT WRONG (something IS there but violates the rules):
   - Halo is on the wrong letter (Z instead of C)
   - Halo is solid colour when it should be gradient on white/grey backgrounds
   - Halo is oval/distorted instead of circular
   - Halo is disproportionately sized (too large or too small)
   - Halo has an outline/stroke when it shouldn't
   - Halo colour doesn't match the flavour palette
   - Logo text is the wrong colour for the background (e.g. navy on dark, white on light)
   - Logo is distorted (stretched, squashed, skewed, rotated, rearranged), or has added shapes/circles behind letters that shouldn't have them
   - Logo has insufficient clear space around it
   - Nicotine warning exists but is NOT at the top of the image
   - Nicotine warning exists but is NOT bilingual (missing French or English)
   - Risk communication exists but is NOT at the bottom
   - Secondary colour is used as a dominant background instead of an accent
   - Wrong font/typeface used (not Santral/sans-serif)
   - Gradient goes in wrong direction or uses wrong colour pairing
   BOTH types are equally important violations. Do NOT only flag missing elements.

USING THE BRAND_DETECTION FACTS:
- The brand detection has already identified what's in the image — colours, positions, shapes, text.
- Cross-reference EVERY detection fact against the rules. If something detected is wrong (wrong colour, wrong position, wrong shape, wrong size), flag it as a violation.
- If brand detection says halo_on_z=true → VIOLATION (halo on wrong letter). This applies to ALL logos including those on product packaging.
- If brand detection says halo_is_gradient=false on a white/grey background → VIOLATION. This applies to ALL logos including those on product packaging.
- If brand detection says halo_shape=oval or distorted → VIOLATION
- If brand detection says halo_has_outline=true → VIOLATION (LOGO-DONT-03)
- If brand detection says halo_proportional=false → VIOLATION (LOGO-DONT-04)
- If brand detection says logo distorted_or_modified=true → VIOLATION (LOGO-13). Note: the Z's angular letter shape is the official design and is NOT distortion. But if there's a circle/shape behind the Z, that IS a real modification — flag it.
- If brand detection says clear_space_sufficient=false → VIOLATION (LOGO-11)
- If brand detection says nicotine_warning_present=true but position is NOT "top" → VIOLATION (REG-04)
- If brand detection says nicotine_warning_bilingual=false → VIOLATION (REG-05)
- If brand detection says risk_communication_present=true but position is NOT "bottom" → VIOLATION (REG-04)
- If brand detection says logo text_colour is wrong for the background type → VIOLATION
- If brand detection says secondary_colour_usage="dominant" → VIOLATION (COLOR-04)
- Always cross-reference the detection facts with each rule. Do NOT override the detection facts with your own assumptions.

RULE STATUS — EVERY RULE MUST BE ONE OF THREE:
1. VIOLATION (in violations array): The rule is clearly broken based on the detection facts and image
2. PASS (in passed_details with status "pass"): The rule is met — confirmed by detection facts
3. NOT APPLICABLE (in passed_details with status "not_applicable"): The rule does not apply to this image type (e.g. "dark background rules" on a white background image)

CRITICAL: Do NOT mark a rule as "pass" if the detection facts show it fails. Trust the detection facts.

SUMMARY REQUIREMENTS (the "summary" field):
Write a detailed visual assessment (4-6 sentences) for a marketing team. NO rule IDs in the summary — use plain language only:
- FIRST: Describe exactly what you see — logo text colour, position, any shapes/circles around or behind letters, the C halo (colour, gradient vs solid, shape), background colour/type, any regulatory text visible, any other design elements.
- THEN: State what follows brand guidelines correctly, in plain language.
- THEN: If there are violations, state what is wrong in plain language (e.g. "the halo around the C is a solid colour but should be a gradient on white backgrounds" NOT "LOGO-05 violation").
- Be PRECISE about colours (navy blue, teal, white), shapes (circle, gradient ring), and positions (top, bottom, around which letter).
- If there's anything unusual around the brand name or logo (wrong colours, extra elements, missing elements, wrong shapes), call it out explicitly.
- If brand detection reports a circle/shape behind the Z letter, explicitly state this in the summary: "There is a circle behind the Z letter that should not be there — only the C should have a halo."
- NEVER include rule IDs like LOGO-05, REG-01 etc. in the summary. The summary is for non-technical marketing teams.
- TONE MATTERS: If the image passes most rules (90%+), lead with what's correct and frame issues as minor improvements. Say things like "This image is largely compliant with brand guidelines" or "The image follows most brand standards correctly." Do NOT use alarmist language for minor issues. If all rules pass, celebrate: "This image fully complies with all brand guidelines."

OVERALL VERDICT (choose carefully — marketing teams see this):
- PASS: No violations, OR only 1-2 minor/medium issues that do not affect brand safety or regulatory compliance
- WARNING: A few violations found but none are critical regulatory failures. The image is mostly compliant with some corrections needed.
- FAIL: Multiple violations, OR any critical regulatory violation (missing warning, missing 18+ icon, missing risk text), OR serious brand misuse (wrong logo, completely wrong colours)

IMPORTANT: An original ZONNIC product image that passes 90%+ of rules should generally get PASS or WARNING, NOT FAIL. Reserve FAIL for images with serious brand or regulatory issues. A single minor visual issue (e.g. gradient vs solid halo) on an otherwise perfect image should be WARNING at most.

VIOLATION REQUIREMENTS:
- Cite the exact rule ID and include the rule text
- Explain what's wrong in plain language a marketing team can understand
- Provide an actionable fix suggestion
- Include bounding box (x, y, w, h) when relevant, null for missing elements

PASSED_DETAILS REQUIREMENTS:
- For rules that PASS: describe what was confirmed using POSITIVE language only.
- CRITICAL WORDING RULE: NEVER mention the Z letter in passed details. Do NOT write "Halo is not on the Z" or "only on the C, not the Z" or any variation. Instead write ONLY what IS correct: "Halo is correctly placed on the C" or "C halo is present and properly positioned." The Z should NEVER appear in any passed detail text.
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
                    "description": "4-6 sentence visual assessment in plain language. NO rule IDs. Describe what you see (logo, colours, shapes, halo, background), what is correct, and what is wrong. Write for non-technical marketing teams."
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
                    "enum": ["gradient", "grey_gradient", "white", "light_image", "dark_image", "solid_colour", "unknown"]
                }
            },
            "required": ["verdict", "confidence", "summary", "checks_performed", "violations", "passed_details", "content_type_detected", "background_type_detected"],
            "additionalProperties": False
        }
    }
}

CHAT_SYSTEM_PROMPT = """You are a ZONNIC brand compliance assistant. The user has already run a compliance check on a marketing image. You have access to the full analysis results including verdict, violations, checks passed, and detected content/background types.

Answer follow-up questions about:
- Why specific violations were flagged — use the friendly check name (e.g. "Logo Clear Space Zone", "Nicotine Warning Banner") NOT the internal rule ID
- How to fix compliance issues with actionable design guidance
- What the ZONNIC brand rules require (regulatory, logo, gradient, colour, content, typography)
- Detailed explanations of any check result
- Bounding box locations and what was detected at those coordinates

Be concise, actionable, and use plain language with friendly check names instead of internal rule IDs. Do NOT reference rule IDs like REG-01, LOGO-03, GRAD-02, CHECK-01 etc. — these are internal codes that end users should not see. If the user asks about something not covered in the analysis results, say so clearly and suggest running a new analysis if needed."""


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

        z_circle_warning = ""
        dense_captions = vision_signals.get("dense_captions", [])
        logo_bboxes = [
            c.get("bbox", {}) for c in dense_captions
            if isinstance(c, dict) and any(
                kw in (c.get("text", "").lower()) for kw in ["zonnic", "logo", "letter"]
            )
        ]
        for dc in dense_captions:
            text_lower = dc.get("text", "").lower() if isinstance(dc, dict) else ""
            bbox = dc.get("bbox", {}) if isinstance(dc, dict) else {}
            if ("circle" in text_lower or "round" in text_lower) and ("letter" in text_lower):
                if logo_bboxes:
                    logo_left = min((b.get("x", 9999) for b in logo_bboxes), default=0)
                    logo_right = max((b.get("x", 0) + b.get("w", 0) for b in logo_bboxes), default=0)
                    logo_width = logo_right - logo_left
                    dc_center_x = bbox.get("x", 0) + bbox.get("w", 0) / 2
                    if logo_width > 0 and dc_center_x < logo_left + logo_width * 0.35:
                        z_circle_warning = f"\n\n⚠️ AUTOMATED SIGNAL: The vision API detected '{dc.get('text', '')}' at bbox {bbox} which is in the LEFT THIRD of the logo area (near the Z). This strongly suggests a filled circle/shape behind the Z letter. You MUST report halo_on_z=true unless you can clearly see there is NO circle behind the Z."
                        logger.warning("Pre-LLM signal: Dense caption '%s' at left-side bbox %s (logo area %d-%d) — likely circle on Z", dc.get("text"), bbox, logo_left, logo_right)
                        break
                    else:
                        logger.info("Pre-LLM signal: Dense caption '%s' at bbox %s is NOT in left third of logo area (%d-%d) — ignoring as likely C halo or product element", dc.get("text"), bbox, logo_left, logo_right)
                else:
                    all_bboxes = [c.get("bbox", {}) for c in dense_captions if isinstance(c, dict)]
                    rightmost_x = max((b.get("x", 0) + b.get("w", 0) for b in all_bboxes), default=0)
                    dc_center_x = bbox.get("x", 0) + bbox.get("w", 0) / 2
                    if rightmost_x > 0 and dc_center_x < rightmost_x * 0.3:
                        z_circle_warning = f"\n\n⚠️ AUTOMATED SIGNAL: The vision API detected '{dc.get('text', '')}' at bbox {bbox} which is on the LEFT side. This strongly suggests a filled circle/shape behind the Z letter. You MUST report halo_on_z=true unless you can clearly see there is NO circle behind the Z."
                        logger.warning("Pre-LLM signal: Dense caption '%s' at left-side bbox %s — likely circle on Z", dc.get("text"), bbox)
                        break

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

IMPORTANT: Check vision data above for any dense caption describing "letter in a circle" or similar — if the bounding box is on the LEFT side of the logo (the Z position), this strongly suggests there is a filled circle behind the Z letter. Report halo_on_z=true in that case.{z_circle_warning}
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
        if is_grad:
            lines.append("  Halo is gradient (two colours): YES")
        else:
            bg_type_val = bg.get("type", "unknown")
            if bg_type_val in ("white", "grey_gradient"):
                lines.append("  Halo is gradient (two colours): NO — solid single colour (on white/grey background the halo MUST be a gradient per LOGO-05)")
            elif bg_type_val == "gradient":
                lines.append("  Halo is gradient (two colours): NO — solid single colour (correct on gradient backgrounds — halo uses secondary colour per LOGO-02)")
            else:
                lines.append("  Halo is gradient (two colours): NO — solid single colour")
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

    content_type = detection.get("content_type", "").lower()

    if halo.get("halo_on_z") is True:
        if "LOGO-DONT-02" not in violation_ids:
            logger.warning("CROSS-VALIDATION: Detection says halo_on_z=true but LLM passed LOGO-DONT-02 — forcing violation")
            forced_violations.append({
                "rule_id": "LOGO-DONT-02",
                "rule_text": "Don't add the halo on the Z instead of the C.",
                "severity": "critical",
                "issue": "There is a circle/shape behind the Z letter. Only the C should have a halo — no other letter should have any shape behind it.",
                "fix_suggestion": "Remove the circle from behind the Z. The halo belongs only on the C (the last letter in ZONNIC).",
                "evidence": "Brand detection confirmed a circle/shape is present behind the Z letter.",
                "bbox": None,
            })
        if "LOGO-13" not in violation_ids:
            logger.warning("CROSS-VALIDATION: Halo on Z means logo is modified — forcing LOGO-13 violation")
            forced_violations.append({
                "rule_id": "LOGO-13",
                "rule_text": "The logo should never be altered or recreated in any way.",
                "severity": "critical",
                "issue": "The logo has been modified — a circle/shape has been added behind the Z letter. In the correct ZONNIC logo, only the C has a halo behind it. No other letter should have any shape.",
                "fix_suggestion": "Remove the circle/shape from behind the Z and use the official unmodified ZONNIC logo.",
                "evidence": "Brand detection confirmed a circle/shape behind the Z letter, which is not part of the official logo design.",
                "bbox": None,
            })

    other_letters_raw = halo.get("halo_on_other_letters", "none")
    has_other = other_letters_raw and str(other_letters_raw).lower() not in ("none", "n/a", "no", "")
    if has_other:
        if "LOGO-DONT-11" not in violation_ids:
            logger.warning("CROSS-VALIDATION: Detection says halo on other letters (%s) — forcing LOGO-DONT-11", other_letters_raw)
            forced_violations.append({
                "rule_id": "LOGO-DONT-11",
                "rule_text": "Don't put the halo on any letter other than the C.",
                "severity": "critical",
                "issue": f"A circle/shape was detected behind the letter(s): {other_letters_raw}. Only the C should have a halo.",
                "fix_suggestion": "Remove any circles or shapes from behind letters other than C. Only the C gets a halo.",
                "evidence": f"Brand detection confirmed shapes behind: {other_letters_raw}.",
                "bbox": None,
            })
        if "LOGO-13" not in violation_ids and "LOGO-13" not in {v["rule_id"] for v in forced_violations}:
            forced_violations.append({
                "rule_id": "LOGO-13",
                "rule_text": "The logo should never be altered or recreated in any way.",
                "severity": "critical",
                "issue": f"The logo has been modified — shapes have been added behind letter(s) {other_letters_raw} that should not have them.",
                "fix_suggestion": "Use the official unmodified ZONNIC logo where only the C has a halo.",
                "evidence": f"Brand detection confirmed unauthorized shapes behind: {other_letters_raw}.",
                "bbox": None,
            })

    if logo.get("distorted_or_modified") is True:
        if "LOGO-13" not in violation_ids and "LOGO-13" not in {v["rule_id"] for v in forced_violations}:
            logger.warning("CROSS-VALIDATION: Logo detected as distorted/modified — forcing LOGO-13")
            forced_violations.append({
                "rule_id": "LOGO-13",
                "rule_text": "The logo should never be altered or recreated in any way.",
                "severity": "critical",
                "issue": "The logo appears to have been altered or modified from its official design.",
                "fix_suggestion": "Use the official unmodified ZONNIC logo.",
                "evidence": "Brand detection flagged the logo as distorted or modified.",
                "bbox": None,
            })

    logo_not_present = logo.get("present") is False
    is_educational = "educational" in content_type or "testimonial" in content_type
    if not halo.get("any_halo_present", True) and not logo_not_present:
        if is_educational:
            logger.info("CROSS-VALIDATION: No halo detected but content is educational — skipping LOGO-DONT-01 enforcement (logo may be legitimately absent)")
        elif "LOGO-DONT-01" not in violation_ids:
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
        other = halo.get("halo_on_other_letters", "")
        if "LOGO-DONT-11" not in violation_ids:
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
        if "LOGO-13" not in violation_ids:
            logger.warning("CROSS-VALIDATION: Halo on other letters '%s' means logo is modified — forcing LOGO-13", other)
            forced_violations.append({
                "rule_id": "LOGO-13",
                "rule_text": "The logo should never be altered or recreated in any way.",
                "severity": "critical",
                "issue": f"The logo has been modified — there are circles/shapes behind letter(s) other than C ({other}). The official ZONNIC logo only has a halo on the C.",
                "fix_suggestion": f"Remove the circle/shape from behind the letter(s) {other}. Only the C should have a halo ring.",
                "evidence": f"Brand detection confirmed halos/shapes on: {other}, which means the logo has been modified from its original design.",
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

    if logo.get("distorted_or_modified") is True:
        if "LOGO-13" not in violation_ids:
            logger.warning("CROSS-VALIDATION: Logo distorted/modified but LLM passed LOGO-13 — forcing violation")
            forced_violations.append({
                "rule_id": "LOGO-13",
                "rule_text": "The ZONNIC logo must not be distorted, stretched, or modified in any way.",
                "severity": "critical",
                "issue": "The ZONNIC logo appears distorted, stretched, or otherwise modified from its original design.",
                "fix_suggestion": "Use the original, unmodified ZONNIC logo file. Do not stretch, skew, or alter the logo.",
                "evidence": "Brand detection confirmed the logo is distorted or modified.",
                "bbox": None,
            })

    if logo.get("present") and logo.get("clear_space_sufficient") is False:
        if "LOGO-11" not in violation_ids:
            logger.warning("CROSS-VALIDATION: Insufficient clear space but LLM passed LOGO-11 — forcing violation")
            forced_violations.append({
                "rule_id": "LOGO-11",
                "rule_text": "Maintain a minimum clear space zone around the logo equal to the height of the letter 'O'.",
                "severity": "high",
                "issue": "Other elements are too close to the ZONNIC logo — there is not enough clear space around it.",
                "fix_suggestion": "Increase the spacing around the logo so no other elements intrude into the clear space zone.",
                "evidence": "Brand detection confirmed insufficient clear space around the logo.",
                "bbox": None,
            })

    if halo.get("any_halo_present") and halo.get("halo_shape", "circle").lower() in ("oval", "distorted", "irregular"):
        if "LOGO-DONT-15" not in violation_ids:
            shape = halo.get("halo_shape", "distorted")
            logger.warning("CROSS-VALIDATION: Halo shape is '%s' but LLM passed LOGO-DONT-15 — forcing violation", shape)
            forced_violations.append({
                "rule_id": "LOGO-DONT-15",
                "rule_text": "The C halo must be a perfect circle, not distorted or oval.",
                "severity": "high",
                "issue": f"The halo around the C is {shape} instead of a perfect circle.",
                "fix_suggestion": "Redraw the halo as a perfect circle around the letter C.",
                "evidence": f"Brand detection confirmed the halo shape is '{shape}'.",
                "bbox": None,
            })

    if halo.get("any_halo_present") and halo.get("halo_proportional") is False:
        if "LOGO-DONT-04" not in violation_ids:
            logger.warning("CROSS-VALIDATION: Halo disproportionate but LLM passed LOGO-DONT-04 — forcing violation")
            forced_violations.append({
                "rule_id": "LOGO-DONT-04",
                "rule_text": "Don't make the halo disproportionately large or small relative to the C.",
                "severity": "high",
                "issue": "The halo around the C is disproportionately sized — either too large or too small relative to the letter.",
                "fix_suggestion": "Resize the halo so it is proportional to the letter C.",
                "evidence": "Brand detection confirmed the halo is not proportional to the C letter.",
                "bbox": None,
            })

    if halo.get("any_halo_present") and halo.get("halo_has_outline") is True:
        if "LOGO-DONT-03" not in violation_ids:
            outline_col = halo.get("halo_outline_colour", "unknown")
            logger.warning("CROSS-VALIDATION: Halo has outline but LLM passed LOGO-DONT-03 — forcing violation")
            forced_violations.append({
                "rule_id": "LOGO-DONT-03",
                "rule_text": "Don't add an outline over the halo.",
                "severity": "high",
                "issue": f"The halo around the C has an outline/stroke ({outline_col}) which should not be present.",
                "fix_suggestion": "Remove the outline/stroke from the C halo. The halo should be a clean ring without any border.",
                "evidence": f"Brand detection confirmed the halo has an outline in {outline_col}.",
                "bbox": None,
            })

    if reg.get("nicotine_warning_present") and not reg.get("nicotine_warning_bilingual", True):
        if "REG-05" not in violation_ids:
            warning_text = reg.get("nicotine_warning_text", "")
            logger.warning("CROSS-VALIDATION: Warning not bilingual but LLM passed REG-05 — forcing violation")
            forced_violations.append({
                "rule_id": "REG-05",
                "rule_text": "The nicotine warning must be bilingual (English + French).",
                "severity": "critical",
                "issue": "The nicotine warning is present but not bilingual — it is missing either the English or French version.",
                "fix_suggestion": "Add both English and French versions of the nicotine warning statement.",
                "evidence": f"Brand detection confirmed the warning is not bilingual. Warning text found: '{warning_text[:100]}'.",
                "bbox": None,
            })

    if reg.get("nicotine_warning_present"):
        pos = reg.get("nicotine_warning_position", "").lower()
        if pos and "top" not in pos:
            if "REG-04" not in violation_ids:
                logger.warning("CROSS-VALIDATION: Warning at '%s' not top — forcing REG-04 violation", pos)
                forced_violations.append({
                    "rule_id": "REG-04",
                    "rule_text": "The nicotine warning banner must be at the TOP of the creative.",
                    "severity": "critical",
                    "issue": f"The nicotine warning is present but positioned at the {pos} instead of the top of the image.",
                    "fix_suggestion": "Move the nicotine warning banner to the top of the image.",
                    "evidence": f"Brand detection found the warning at position: {pos}.",
                    "bbox": None,
                })

    if reg.get("risk_communication_present"):
        pos = reg.get("risk_communication_position", "").lower()
        if pos and "bottom" not in pos:
            if "REG-04" not in violation_ids:
                logger.warning("CROSS-VALIDATION: Risk text at '%s' not bottom — forcing REG-04 violation", pos)
                forced_violations.append({
                    "rule_id": "REG-04",
                    "rule_text": "Risk communication text must be at the BOTTOM of the creative.",
                    "severity": "critical",
                    "issue": f"The risk communication text is present but positioned at the {pos} instead of the bottom of the image.",
                    "fix_suggestion": "Move the risk communication text to the bottom of the image.",
                    "evidence": f"Brand detection found risk text at position: {pos}.",
                    "bbox": None,
                })

    bg_type_str = bg.get("type", "")
    if logo.get("present"):
        logo_colour = logo.get("text_colour", "").lower()
        if bg_type_str in ("white", "solid_colour", "grey_gradient", "gradient") and "dark" not in bg_type_str:
            if logo_colour and "navy" not in logo_colour and "blue" not in logo_colour and "dark" not in logo_colour and logo_colour not in ("not present", "unknown", ""):
                if "LOGO-06" not in violation_ids:
                    logger.warning("CROSS-VALIDATION: Logo colour '%s' on light background — forcing LOGO-06 violation", logo_colour)
                    forced_violations.append({
                        "rule_id": "LOGO-06",
                        "rule_text": "On white or light backgrounds, the ZONNIC text must be navy blue.",
                        "severity": "high",
                        "issue": f"The logo text is {logo_colour} on a {bg_type_str} background — it should be navy blue.",
                        "fix_suggestion": "Change the logo text colour to navy blue (#242c65) for light backgrounds.",
                        "evidence": f"Brand detection found logo text colour is '{logo_colour}' on a '{bg_type_str}' background.",
                        "bbox": None,
                    })
        elif bg_type_str in ("dark_image",):
            if logo_colour and "white" not in logo_colour and logo_colour not in ("not present", "unknown", ""):
                if "LOGO-10" not in violation_ids:
                    logger.warning("CROSS-VALIDATION: Logo colour '%s' on dark background — forcing LOGO-10 violation", logo_colour)
                    forced_violations.append({
                        "rule_id": "LOGO-10",
                        "rule_text": "On dark image backgrounds, the ZONNIC text must be white for visibility.",
                        "severity": "high",
                        "issue": f"The logo text is {logo_colour} on a dark background — it should be white.",
                        "fix_suggestion": "Change the logo text colour to white (#FFFFFF) for dark backgrounds.",
                        "evidence": f"Brand detection found logo text colour is '{logo_colour}' on a dark background.",
                        "bbox": None,
                    })

    colours = detection.get("colours", {})
    sec_usage = colours.get("secondary_colour_usage", "").lower()
    bg_colour = detection.get("background", {}).get("type", "").lower() if isinstance(detection.get("background"), dict) else str(detection.get("background", "")).lower()
    primary_bg = any(w in bg_colour for w in ["white", "navy", "dark", "gradient"])
    sec_colour_name = colours.get("secondary_colour", "").lower()
    sec_is_actually_primary = any(w in sec_colour_name for w in ["white", "navy", "navy blue"])

    if ("dominant" in sec_usage or "background" in sec_usage) and not primary_bg and not sec_is_actually_primary:
        if "COLOR-04" not in violation_ids:
            logger.warning("CROSS-VALIDATION: Secondary colour used as dominant — forcing COLOR-04 violation")
            forced_violations.append({
                "rule_id": "COLOR-04",
                "rule_text": "Secondary/accent colours must not be used as the dominant background colour.",
                "severity": "high",
                "issue": "A secondary/accent colour is being used as the main background colour instead of as a small accent.",
                "fix_suggestion": "Use the secondary colour only for small accents (halo, icons). Use white, navy, or a brand gradient as the background.",
                "evidence": f"Brand detection found secondary colour usage: '{sec_usage}'.",
                "bbox": None,
            })
    elif ("dominant" in sec_usage or "background" in sec_usage) and (primary_bg or sec_is_actually_primary):
        logger.info("CROSS-VALIDATION: Skipping COLOR-04 — background is '%s' (a primary brand colour), secondary is '%s'", bg_colour, sec_colour_name)

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
            result["verdict"] = "WARNING"


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
