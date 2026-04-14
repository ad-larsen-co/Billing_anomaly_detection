import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import {
  analyzeCsv,
  nlpQuery,
  postFeedback,
  type AnalysisRun,
  type Anomaly,
} from "./api";

function Badge({ children, tone }: { children: ReactNode; tone: "red" | "amber" | "blue" | "slate" }) {
  const map = {
    red: "bg-rose-50 text-rose-700 ring-rose-100",
    amber: "bg-amber-50 text-amber-800 ring-amber-100",
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${map[tone]}`}>
      {children}
    </span>
  );
}

function severityTone(s: string): "red" | "amber" | "blue" | "slate" {
  if (s === "high") return "red";
  if (s === "medium") return "amber";
  if (s === "low") return "blue";
  return "slate";
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [selected, setSelected] = useState<Anomaly | null>(null);

  const [chat, setChat] = useState("");
  const [chatLog, setChatLog] = useState<{ q: string; a: string }[]>([]);
  const [chatBusy, setChatBusy] = useState(false);

  const onUpload = useCallback(async () => {
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const r = await analyzeCsv(file);
      setRun(r);
      if (r.anomalies.length) setSelected(r.anomalies[0]);
    } catch (e: unknown) {
      const msg =
        (axiosIsError(e) && e.response?.data?.detail) ||
        (e instanceof Error ? e.message : String(e));
      setError(typeof msg === "string" ? msg : JSON.stringify(msg));
    } finally {
      setLoading(false);
    }
  }, [file]);

  const onAsk = async () => {
    if (!chat.trim()) return;
    setChatBusy(true);
    setError(null);
    try {
      const res = await nlpQuery(chat.trim());
      setChatLog((prev) => [...prev, { q: chat.trim(), a: res.answer }]);
      setChat("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setChatBusy(false);
    }
  };

  const anomalies = run?.anomalies ?? [];

  const stats = useMemo(() => {
    if (!run) return null;
    return {
      total: run.total_rows,
      hits: run.anomaly_count,
      rate: run.total_rows ? ((run.anomaly_count / run.total_rows) * 100).toFixed(1) : "0",
    };
  }, [run]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 flex-shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
          <div className="border-b border-slate-100 px-5 py-4">
            <div className="text-sm font-semibold text-slate-900">Billing Console</div>
            <div className="text-xs text-slate-500">Anomaly detection & RAG</div>
          </div>
          <nav className="flex-1 space-y-1 px-3 py-4 text-sm">
            <div className="rounded-lg bg-slate-100 px-3 py-2 font-medium text-slate-900">Overview</div>
            <div className="px-3 py-2 text-slate-600">Alerts</div>
            <div className="px-3 py-2 text-slate-600">Evidence</div>
            <div className="px-3 py-2 text-slate-600">Assistant</div>
          </nav>
          <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            FastAPI · pgvector · GPT‑4o‑mini
          </div>
        </aside>

        <main className="flex-1">
          <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
              <div>
                <h1 className="text-lg font-semibold tracking-tight text-slate-900">
                  Billing anomaly workspace
                </h1>
                <p className="text-sm text-slate-500">
                  Upload Oracle-style billing CSV, review model output, evidence, and remediation.
                </p>
              </div>
              <div className="hidden items-center gap-2 sm:flex">
                <Badge tone="blue">HF Space</Badge>
                <Badge tone="slate">Dual RAG</Badge>
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {error}
              </div>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Data ingest</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Required columns: order_id, customer_id, order_date, product_id, product_name, category,
                    price, quantity, payment_method, country, city, is_fraud
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100">
                    <input
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                    Choose CSV
                  </label>
                  <button
                    type="button"
                    onClick={onUpload}
                    disabled={loading}
                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
                  >
                    {loading ? "Analyzing…" : "Run analysis"}
                  </button>
                </div>
              </div>
              {file && (
                <div className="mt-3 text-xs text-slate-600">
                  Selected: <span className="font-mono">{file.name}</span>
                </div>
              )}
            </section>

            {stats && (
              <section className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-medium text-slate-500">Rows processed</div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">{stats.total}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-medium text-slate-500">Anomalies</div>
                  <div className="mt-2 text-2xl font-semibold text-rose-600">{stats.hits}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-medium text-slate-500">Alert rate</div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">{stats.rate}%</div>
                </div>
              </section>
            )}

            <div className="grid gap-6 lg:grid-cols-5">
              <section className="lg:col-span-2">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900">Anomaly alerts</h2>
                  <span className="text-xs text-slate-500">{anomalies.length} items</span>
                </div>
                <div className="max-h-[520px] space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                  {anomalies.length === 0 && (
                    <div className="px-3 py-8 text-center text-sm text-slate-500">
                      No anomalies yet. Upload a CSV to populate this list.
                    </div>
                  )}
                  {anomalies.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setSelected(a)}
                      className={`w-full rounded-xl px-3 py-3 text-left transition hover:bg-slate-50 ${
                        selected?.id === a.id ? "bg-blue-50 ring-1 ring-blue-100" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-mono text-xs text-slate-500">
                          {a.order_id ?? `row ${a.row_index}`}
                        </div>
                        <Badge tone={severityTone(a.severity)}>{a.severity}</Badge>
                      </div>
                      <div className="mt-1 text-sm font-medium text-slate-900">{a.anomaly_type}</div>
                      <div className="mt-1 line-clamp-2 text-xs text-slate-600">{a.explanation}</div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="lg:col-span-3">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900">Evidence & remediation</h2>
                  {selected && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        onClick={async () => {
                          try {
                            await postFeedback(selected.id, "approve");
                          } catch (e) {
                            setError(e instanceof Error ? e.message : String(e));
                          }
                        }}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        onClick={async () => {
                          try {
                            await postFeedback(selected.id, "dismiss");
                          } catch (e) {
                            setError(e instanceof Error ? e.message : String(e));
                          }
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
                <div className="min-h-[320px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  {!selected && (
                    <div className="text-sm text-slate-500">Select an alert to view details.</div>
                  )}
                  {selected && (
                    <div className="space-y-4">
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Confidence
                        </div>
                        <div className="mt-1 text-2xl font-semibold text-slate-900">
                          {(selected.confidence * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Explanation
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-slate-700">
                          {selected.explanation ?? "—"}
                        </p>
                      </div>
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Fact RAG · contract evidence
                        </div>
                        <ul className="mt-2 space-y-2">
                          {(selected.evidence_refs ?? []).length === 0 && (
                            <li className="text-sm text-slate-500">No snippets retrieved.</li>
                          )}
                          {(selected.evidence_refs ?? []).map((ev, idx) => (
                            <li
                              key={idx}
                              className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                            >
                              <div className="text-xs font-semibold text-slate-900">
                                {String(ev.title ?? "Clause")}
                              </div>
                              <div className="mt-1 whitespace-pre-wrap text-xs text-slate-600">
                                {String(ev.excerpt ?? "")}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Solver RAG · playbook
                        </div>
                        <div className="mt-2 whitespace-pre-wrap rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-3 text-sm text-slate-800">
                          {selected.remediation ?? "—"}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-900">Natural language assistant</h2>
                    <Badge tone="blue">GPT‑4o‑mini</Badge>
                  </div>
                  <div className="max-h-56 space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-3 text-sm">
                    {chatLog.length === 0 && (
                      <div className="text-slate-500">
                        Try: “How many anomalies were detected?”, “List high severity alerts”, “What does the
                        contract say about tax?”
                      </div>
                    )}
                    {chatLog.map((c, i) => (
                      <div key={i} className="space-y-1">
                        <div className="font-medium text-slate-900">Q: {c.q}</div>
                        <div className="text-slate-700">A: {c.a}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input
                      className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-blue-100 focus:ring-2"
                      placeholder="Ask about anomalies, contracts, or recent runs…"
                      value={chat}
                      onChange={(e) => setChat(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && onAsk()}
                    />
                    <button
                      type="button"
                      onClick={onAsk}
                      disabled={chatBusy}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {chatBusy ? "…" : "Ask"}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function axiosIsError(e: unknown): e is { response?: { data?: { detail?: unknown } } } {
  return typeof e === "object" && e !== null && "response" in e;
}
