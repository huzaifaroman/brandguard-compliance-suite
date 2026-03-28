import type {
  ComplianceResult,
  BatchResult,
  ChatMessage,
  HistoryResponse,
} from "./types";

const API_BASE = "";

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
  return res.json();
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
  return res.json();
}

export async function getRules(): Promise<{ rules: unknown }> {
  const res = await fetch(`${API_BASE}/api/rules`);
  if (!res.ok) throw new Error("Failed to fetch rules");
  return res.json();
}

export async function getHistory(
  limit = 50,
  offset = 0
): Promise<HistoryResponse> {
  const res = await fetch(
    `${API_BASE}/api/history?limit=${limit}&offset=${offset}`
  );
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json();
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
          if (data.done) onDone();
        } catch {}
      }
    })
    .catch(onError);
}

export async function checkHealth() {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error("Backend not reachable");
  return res.json();
}
