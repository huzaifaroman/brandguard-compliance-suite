from pydantic import BaseModel, Field
from typing import Optional, List, Any, Literal
from datetime import datetime


class BoundingBox(BaseModel):
    x: float
    y: float
    w: float
    h: float


class Violation(BaseModel):
    rule_id: str
    rule_text: str = ""
    severity: str = "medium"
    issue: str
    fix_suggestion: str = ""
    evidence: str = ""
    bbox: Optional[BoundingBox] = None


class PassedDetail(BaseModel):
    rule_id: str
    category: Literal["Regulatory", "Logo", "Gradient", "Colors", "Typography", "Content"] = "Content"
    detail: str
    status: Literal["pass", "not_applicable"] = "pass"


class ComplianceResult(BaseModel):
    image_url: Optional[str] = None
    image_width: Optional[int] = None
    image_height: Optional[int] = None
    verdict: str
    confidence: float
    violations: List[Violation] = []
    passed_details: List[PassedDetail] = []
    checks_passed: Any = Field(default=0, exclude=True)
    summary: str = ""
    content_type_detected: str = "unknown"
    background_type_detected: str = "unknown"
    session_id: Optional[str] = None
    cached: bool = False
    image_hash: Optional[str] = None
    timestamp: Optional[datetime] = None


class BatchImageResult(BaseModel):
    image_name: str
    verdict: str
    confidence: float
    violations: List[Violation] = []
    passed_details: List[PassedDetail] = []
    image_url: Optional[str] = None
    image_width: Optional[int] = None
    image_height: Optional[int] = None
    session_id: Optional[str] = None
    summary: Optional[str] = None
    content_type_detected: Optional[str] = None
    background_type_detected: Optional[str] = None
    error: Optional[str] = None


class BatchSummary(BaseModel):
    passed: int = 0
    failed: int = 0
    warnings: int = 0


class BatchResult(BaseModel):
    batch_id: str
    total_images: int
    summary: BatchSummary
    results: List[BatchImageResult]


class ChatMessage(BaseModel):
    role: str
    content: str
    message_type: str = "text"
    timestamp: Optional[datetime] = None


class ChatRequest(BaseModel):
    message: str


class RulesResponse(BaseModel):
    rules: Any


class HistoryItem(BaseModel):
    id: int
    image_hash: str
    blob_url: Optional[str]
    verdict: str
    confidence: float
    violations_count: int
    session_id: Optional[str]
    timestamp: datetime


class HistoryResponse(BaseModel):
    items: List[HistoryItem]
    total: int
