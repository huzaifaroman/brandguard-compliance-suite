import type {
  ComplianceResult,
  BatchResult,
  ChatMessage,
  HistoryResponse,
} from "./types";
import { cacheGet, cacheSet, cacheInvalidatePrefix } from "./cache";

const API_BASE = "";

const RULES_TTL = 5 * 60 * 1000;
const HISTORY_TTL = 30 * 1000;
const HEALTH_TTL = 15 * 1000;

export async function analyzeImage(
  file: File,
  prompt?: string
): Promise<ComplianceResult> {
  const formData = new FormData();
  formData.append("file", file);
  if (prompt) formData.append("prompt", prompt);

  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(`Analysis failed: ${res.statusText}`);
  const result = await res.json();
  cacheInvalidatePrefix("history:");
  return result;
}

export function streamAnalysis(
  file: File,
  prompt: string | undefined,
  onChunk: (text: string) => void,
  onDone: (result: ComplianceResult) => void,
  onError: (err: Error) => void
) {
  analyzeImage(file, prompt).then(onDone).catch(onError);
}

export async function batchAnalyze(files: File[]): Promise<BatchResult> {
  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));

  const res = await fetch(`${API_BASE}/api/batch`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(`Batch analysis failed: ${res.statusText}`);
  const result = await res.json();
  cacheInvalidatePrefix("history:");
  return result;
}

export async function getRules(): Promise<{ rules: unknown }> {
  const cached = cacheGet<{ rules: unknown }>("rules");
  if (cached) return cached;

  const res = await fetch(`${API_BASE}/api/rules`);
  if (!res.ok) throw new Error("Failed to fetch rules");
  const data = await res.json();
  cacheSet("rules", data, RULES_TTL);
  return data;
}

export async function getHistory(
  limit = 50,
  offset = 0
): Promise<HistoryResponse> {
  const key = `history:${limit}:${offset}`;
  const cached = cacheGet<HistoryResponse>(key);
  if (cached) return cached;

  const res = await fetch(
    `${API_BASE}/api/history?limit=${limit}&offset=${offset}`
  );
  if (!res.ok) throw new Error("Failed to fetch history");
  const data = await res.json();
  cacheSet(key, data, HISTORY_TTL);
  return data;
}

export async function getChatMessages(
  sessionId: string
): Promise<ChatMessage[]> {
  const res = await fetch(`${API_BASE}/api/chat/${sessionId}/messages`);
  if (!res.ok) return [];
  return res.json();
}

export function streamChatMessage(
  sessionId: string,
  message: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: Error) => void
) {
  fetch(`${API_BASE}/api/chat/${sessionId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  })
    .then(async (res) => {
      if (!res.ok || !res.body) throw new Error("Chat request failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              if (data.content) onChunk(data.content);
              if (data.done) onDone();
            } catch {}
          }
        }
      }
      if (buffer.trim().startsWith("data: ")) {
        try {
          const data = JSON.parse(buffer.trim().slice(6));
          if (data.content) onChunk(data.content);
          if (data.done) { onDone(); return; }
        } catch {}
      }
      onDone();
    })
    .catch(onError);
}

export async function checkHealth() {
  const cached = cacheGet<unknown>("health");
  if (cached) return cached;

  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error("Backend not reachable");
  const data = await res.json();
  cacheSet("health", data, HEALTH_TTL);
  return data;
}

const prefetchPromises = new Map<string, Promise<void>>();

export function prefetchRoute(route: string): void {
  if (prefetchPromises.has(route)) return;

  let promise: Promise<void>;
  switch (route) {
    case "/rules":
      promise = getRules().then(() => {});
      break;
    case "/history":
      promise = getHistory().then(() => {});
      break;
    default:
      return;
  }

  prefetchPromises.set(route, promise);
  promise.finally(() => {
    setTimeout(() => prefetchPromises.delete(route), 5000);
  });
}
