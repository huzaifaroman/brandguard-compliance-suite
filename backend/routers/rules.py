from fastapi import APIRouter, Request
from backend.models.schemas import RulesResponse
from backend import redis_client

router = APIRouter(prefix="/api", tags=["rules"])


@router.get("/rules", response_model=RulesResponse)
async def get_rules(request: Request):
    cached = await redis_client.get_cached_rules()
    if cached:
        return RulesResponse(rules=cached)

    rules = getattr(request.app.state, "rules", {})
    return RulesResponse(rules=rules)
