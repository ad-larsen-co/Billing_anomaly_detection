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

export async function nlpQuery(question: string) {
  const res = await client.post("/api/nlp/query", { question });
  return res.data as {
    intent: string;
    answer: string;
    sql_used: string | null;
    structured_rows: Array<Record<string, unknown>> | null;
  };
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
  return res.data;
}
