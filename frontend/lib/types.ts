export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Violation {
  rule_id: string;
  rule_text: string;
  severity: "critical" | "high" | "medium";
  issue: string;
  fix_suggestion: string;
  evidence: string;
  bbox: BoundingBox | null;
}

export interface PassedDetail {
  rule_id: string;
  category: "Regulatory" | "Logo" | "Gradient" | "Colors" | "Typography" | "Content";
  detail: string;
  status?: "pass" | "not_applicable";
}

export interface CheckPerformed {
  check_id: string;
  check_name: string;
  status: "pass" | "fail" | "not_applicable";
  detail: string;
}

export interface ComplianceResult {
  image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  verdict: "PASS" | "FAIL" | "WARNING";
  confidence: number;
  violations: Violation[];
  passed_details: PassedDetail[];
  checks_performed?: CheckPerformed[];
  summary: string;
  content_type_detected: string;
  background_type_detected: string;
  session_id: string | null;
  cached: boolean;
  image_hash: string | null;
  timestamp?: string;
}

export interface BatchImageResult {
  image_name: string;
  verdict: "PASS" | "FAIL" | "WARNING";
  confidence: number;
  violations: Violation[];
  passed_details: PassedDetail[];
  image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  session_id: string | null;
  summary: string | null;
  content_type_detected: string | null;
  background_type_detected: string | null;
  error?: string;
}

export interface BatchSummary {
  passed: number;
  failed: number;
  warnings: number;
}

export interface BatchResult {
  batch_id: string;
  total_images: number;
  summary: BatchSummary;
  results: BatchImageResult[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  message_type?: string;
  timestamp?: string;
}

export interface HistoryItem {
  id: number;
  image_hash: string;
  blob_url: string | null;
  verdict: string;
  confidence: number;
  violations_count: number;
  session_id: string | null;
  timestamp: string;
}

export interface HistoryResponse {
  items: HistoryItem[];
  total: number;
}

export interface RuleMeta {
  document: string;
  source: string;
  pages: number;
  brand: string;
  company: string;
  classification: string;
  total_rules: number;
}

export interface RuleItem {
  id: string;
  category?: string;
  rule: string;
  severity: string;
  legal_requirement?: boolean;
  visual_description?: string;
  [key: string]: unknown;
}

export interface HealthStatus {
  status: string;
  rules_loaded: boolean;
  azure_openai_configured: boolean;
  azure_vision_configured: boolean;
  azure_blob_configured: boolean;
  postgres_configured: boolean;
  redis_configured: boolean;
}
