import axios from "axios";

const client = axios.create({
  baseURL: "",
  timeout: 300000,
});

export type Anomaly = {
  id: string;
  row_index: number;
  order_id: string | null;
  customer_id: string | null;
  anomaly_type: string;
  severity: string;
  explanation: string | null;
  confidence: number;
  evidence_refs: Array<Record<string, unknown>> | null;
  remediation: string | null;
  model_payload: Record<string, unknown> | null;
};

export type AnalysisRun = {
  id: string;
  filename: string | null;
  total_rows: number;
  anomaly_count: number;
  created_at: string;
  anomalies: Anomaly[];
  raw_summary: Record<string, unknown> | null;
};

export async function analyzeCsv(file: File): Promise<AnalysisRun> {
  const form = new FormData();
  form.append("file", file);
  const res = await client.post<AnalysisRun>("/api/analyze", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export type ChatMessageIn = { role: "user" | "assistant"; content: string };

export async function nlpQuery(question: string, messages: ChatMessageIn[] = []) {
  const res = await client.post("/api/nlp/query", {
    question,
    messages,
    session_id: null,
  });
  return res.data as {
    intent: string;
    answer: string;
    sql_used: string | null;
    structured_rows: Array<Record<string, unknown>> | null;
  };
}

export type StreamNlpEvent =
  | { meta: { intent: string; sql_used: string | null } }
  | { delta: string }
  | { error: string }
  | { done: true };

/** POST /api/nlp/query/stream — SSE `data: {...}` lines */
export async function nlpQueryStream(
  question: string,
  messages: ChatMessageIn[],
  sessionId: string | undefined,
  onEvent: (e: StreamNlpEvent) => void
): Promise<void> {
  const res = await fetch("/api/nlp/query/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      messages,
      session_id: sessionId ?? null,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (;;) {
      const idx = buf.indexOf("\n\n");
      if (idx === -1) break;
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = block.trim();
      if (!line.startsWith("data:")) continue;
      const json = line.slice(5).trim();
      try {
        const data = JSON.parse(json) as Record<string, unknown>;
        if (data.done === true) {
          onEvent({ done: true });
        } else if (typeof data.error === "string") {
          onEvent({ error: data.error });
        } else if (data.meta && typeof data.meta === "object") {
          const m = data.meta as { intent?: string; sql_used?: string | null };
          onEvent({
            meta: {
              intent: String(m.intent ?? ""),
              sql_used: m.sql_used ?? null,
            },
          });
        } else if (typeof data.delta === "string") {
          onEvent({ delta: data.delta });
        }
      } catch {
        /* incomplete chunk */
      }
    }
  }
}

export type FeedbackListItem = {
  id: string;
  anomaly_id: string;
  order_id: string | null;
  action: string;
  notes: string | null;
  created_at: string;
};

export async function fetchFeedbackList(limit = 50): Promise<FeedbackListItem[]> {
  const res = await client.get<FeedbackListItem[]>("/api/feedback", {
    params: { limit },
  });
  return res.data;
}

export async function postFeedback(
  anomalyId: string,
  action: "approve" | "dismiss",
  notes?: string
) {
  const res = await client.post("/api/feedback", {
    anomaly_id: anomalyId,
    action,
    notes: notes ?? null,
  });
  return res.data as {
    id: string;
    anomaly_id: string;
    action: string;
    notes: string | null;
    created_at: string;
  };
}
