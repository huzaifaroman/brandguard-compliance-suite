import json
from typing import Optional, AsyncIterator
from openai import AsyncAzureOpenAI
from config import settings

COMPLIANCE_SCHEMA = {
    "name": "compliance_result",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "verdict": {"type": "string", "enum": ["PASS", "FAIL", "WARNING"]},
            "confidence": {"type": "number"},
            "summary": {"type": "string"},
            "checks_passed": {"type": "integer"},
            "violations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "rule_id": {"type": "string"},
                        "issue": {"type": "string"},
                        "suggestion": {"type": "string"},
                        "severity": {"type": "string", "enum": ["error", "warning", "info"]},
                        "bbox": {
                            "anyOf": [
                                {
                                    "type": "object",
                                    "properties": {
                                        "x": {"type": "number"},
                                        "y": {"type": "number"},
                                        "w": {"type": "number"},
                                        "h": {"type": "number"},
                                    },
                                    "required": ["x", "y", "w", "h"],
                                    "additionalProperties": False,
                                },
                                {"type": "null"},
                            ]
                        },
                    },
                    "required": ["rule_id", "issue", "suggestion", "severity", "bbox"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["verdict", "confidence", "summary", "checks_passed", "violations"],
        "additionalProperties": False,
    },
}


def _get_client() -> AsyncAzureOpenAI:
    return AsyncAzureOpenAI(
        azure_endpoint=settings.azure_openai_endpoint,
        api_key=settings.azure_openai_key,
        api_version=settings.azure_openai_api_version,
    )


def _build_system_prompt(rules: dict) -> str:
    rules_json = json.dumps(rules, indent=2)
    return f"""You are a strict marketing compliance evaluation engine.

You evaluate marketing images against brand compliance rules.
Your verdicts must be deterministic and consistent — the same image always produces the same result.

COMPLIANCE RULES:
{rules_json}

INSTRUCTIONS:
- Analyze the provided visual signals (caption, OCR text, detected objects, colors) against ALL rules
- Return PASS if all rules are satisfied
- Return FAIL if any critical rule (error severity) is violated
- Return WARNING if only non-critical rules (warning/info severity) are violated
- For each violation, include the exact rule_id, a clear explanation of the issue, and a specific fix suggestion
- If a violation corresponds to a detected visual element with bounding box coordinates, include those coordinates
- Confidence should reflect how certain you are about the verdict (0-100)
- Be specific and explainable — the user must understand exactly what is wrong and how to fix it"""


async def analyze_compliance(
    vision_signals: dict,
    rules: dict,
    prompt: Optional[str] = None,
) -> dict:
    """Run GPT-4 compliance analysis. Returns structured compliance result dict."""
    if not settings.azure_openai_endpoint or not settings.azure_openai_key:
        return _mock_result()

    client = _get_client()

    signals_text = json.dumps(vision_signals, indent=2)
    user_content = f"""VISUAL SIGNALS FROM IMAGE:
{signals_text}

{"USER NOTE: " + prompt if prompt else ""}

Evaluate this image against all compliance rules and return your structured analysis."""

    try:
        response = await client.chat.completions.create(
            model=settings.azure_openai_deployment,
            messages=[
                {"role": "system", "content": _build_system_prompt(rules)},
                {"role": "user", "content": user_content},
            ],
            temperature=0,
            top_p=0.1,
            seed=42,
            response_format={"type": "json_schema", "json_schema": COMPLIANCE_SCHEMA},
        )
        await client.close()
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        print(f"LLM error: {e}")
        await client.close()
        return _mock_result()


async def chat_followup(
    session_id: str,
    compliance_result: dict,
    messages: list,
) -> AsyncIterator[str]:
    """Stream a follow-up chat response given the compliance context and message history."""
    if not settings.azure_openai_endpoint or not settings.azure_openai_key:
        yield "Azure OpenAI is not configured yet. Please add your credentials."
        return

    client = _get_client()

    system_prompt = f"""You are a helpful marketing compliance assistant.
You have already analyzed an image and produced this compliance result:

{json.dumps(compliance_result, indent=2)}

Answer the user's follow-up questions about this analysis. Be specific, helpful, and reference rule IDs when relevant."""

    try:
        stream = await client.chat.completions.create(
            model=settings.azure_openai_deployment,
            messages=[{"role": "system", "content": system_prompt}] + messages,
            temperature=0.3,
            seed=42,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                yield delta
        await client.close()
    except Exception as e:
        await client.close()
        yield f"Error: {str(e)}"


def _mock_result() -> dict:
    return {
        "verdict": "WARNING",
        "confidence": 50.0,
        "summary": "Azure OpenAI not configured — this is a placeholder result.",
        "checks_passed": 0,
        "violations": [
            {
                "rule_id": "CONFIG-01",
                "issue": "Azure OpenAI credentials not configured",
                "suggestion": "Add AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_KEY to environment secrets",
                "severity": "warning",
                "bbox": None,
            }
        ],
    }
