export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Violation {
  rule_id: string;
  issue: string;
  suggestion: string;
  severity: "error" | "warning" | "info";
  bbox: BoundingBox | null;
}

export interface ComplianceResult {
  image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  verdict: "PASS" | "FAIL" | "WARNING";
  confidence: number;
  violations: Violation[];
  checks_passed: number;
  summary: string;
  session_id: string | null;
  cached: boolean;
  timestamp?: string;
}

export interface BatchImageResult {
  image_name: string;
  verdict: "PASS" | "FAIL" | "WARNING";
  confidence: number;
  violations: Violation[];
  checks_passed: number;
  image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  session_id: string | null;
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
  message_type: string;
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
