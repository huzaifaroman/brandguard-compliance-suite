from fastapi import APIRouter, Request
from backend.models.schemas import RulesResponse

router = APIRouter(prefix="/api", tags=["rules"])


@router.get("/rules", response_model=RulesResponse)
async def get_rules(request: Request):
    rules = getattr(request.app.state, "rules", {})
    return RulesResponse(rules=rules)
