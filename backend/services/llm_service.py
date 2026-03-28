import json
from typing import Optional, AsyncIterator
from backend.config import settings


async def analyze_compliance(
    vision_signals: dict,
    rules: dict,
    prompt: Optional[str] = None,
) -> dict:
    """
    Run GPT-4 compliance analysis. Stub until Azure OpenAI is configured.
    """
    if not settings.azure_openai_endpoint or not settings.azure_openai_key:
        return _placeholder_result()

    return _placeholder_result()


async def chat_followup(
    session_id: str,
    compliance_result: dict,
    messages: list,
) -> AsyncIterator[str]:
    """Stream a follow-up chat response. Stub until Azure OpenAI is configured."""
    yield "Azure OpenAI is not yet configured. Add your credentials to start using the AI assistant."


def _placeholder_result() -> dict:
    return {
        "verdict": "WARNING",
        "confidence": 50.0,
        "summary": "Azure OpenAI not configured — placeholder result. Add credentials to enable real analysis.",
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
