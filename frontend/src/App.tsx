import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { analyzeCsv, postFeedback, type AnalysisRun, type Anomaly } from "./api";
import ChatAssistant from "./components/ChatAssistant";

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

const FEEDBACK_THUMBS_UP = "/feedback-thumbs-up.png";
const FEEDBACK_THUMBS_DOWN = "/feedback-thumbs-down.png";

function FeedbackThumbImage({
  variant,
  className,
}: {
  variant: "up" | "down";
  className?: string;
}) {
  return (
    <img
      src={variant === "up" ? FEEDBACK_THUMBS_UP : FEEDBACK_THUMBS_DOWN}
      alt=""
      className={`object-contain ${className ?? ""}`}
      draggable={false}
    />
  );
}

function IconAlertCircle(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}

function formatDatasetCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function DatasetPreviewTable({
  rows,
  totalRows,
}: {
  rows: Record<string, unknown>[];
  totalRows: number;
}) {
  if (rows.length === 0) return null;
  const cols = Object.keys(rows[0] ?? {});
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Input dataset</h2>
      <p className="mt-1 text-xs text-slate-500">
        Preview of uploaded CSV — showing {rows.length} of {totalRows} row{totalRows === 1 ? "" : "s"} (capped for
        performance).
      </p>
      <div className="mt-3 max-h-[min(60vh,520px)] overflow-auto rounded-xl border border-slate-100">
        <table className="w-full min-w-max border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-slate-100 shadow-sm">
            <tr>
              {cols.map((c) => (
                <th
                  key={c}
                  className="whitespace-nowrap border-b border-slate-200 px-2 py-2 font-semibold text-slate-800"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-slate-700">
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/80">
                {cols.map((c) => (
                  <td key={c} className="max-w-[16rem] truncate px-2 py-1.5 align-top font-mono text-[11px]">
                    {formatDatasetCell(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type ConsoleSection = "overview" | "alerts" | "evidence" | "assistant";

const SECTION_META: Record<ConsoleSection, { title: string; subtitle: string }> = {
  overview: {
    title: "Overview",
    subtitle: "Ingest billing data, inspect the loaded dataset, and see run metrics.",
  },
  alerts: {
    title: "Anomaly alerts",
    subtitle: "Browse detected anomalies from the latest analysis run.",
  },
  evidence: {
    title: "Evidence & remediation",
    subtitle: "Contract evidence, solver playbook, and human feedback on each alert.",
  },
  assistant: {
    title: "Assistant",
    subtitle: "Ask questions about anomalies, contracts, and recent runs — streaming GPT‑4o‑mini.",
  },
};

const CONSOLE_NAV: { id: ConsoleSection; label: string; hint: string }[] = [
  { id: "overview", label: "Overview", hint: "Upload, stats, dataset" },
  { id: "alerts", label: "Alerts", hint: "Anomaly list" },
  { id: "evidence", label: "Evidence", hint: "RAG evidence & actions" },
  { id: "assistant", label: "Assistant", hint: "NLP chat" },
];

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [selected, setSelected] = useState<Anomaly | null>(null);

  const [consoleSection, setConsoleSection] = useState<ConsoleSection>("overview");

  const [feedbackToast, setFeedbackToast] = useState<{ message: string; tone: "success" | "error" } | null>(
    null
  );

  useEffect(() => {
    if (!feedbackToast) return;
    const id = window.setTimeout(() => setFeedbackToast(null), 4200);
    return () => window.clearTimeout(id);
  }, [feedbackToast]);

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

  const anomalies = run?.anomalies ?? [];

  const stats = useMemo(() => {
    if (!run) return null;
    return {
      total: run.total_rows,
      hits: run.anomaly_count,
      rate: run.total_rows ? ((run.anomaly_count / run.total_rows) * 100).toFixed(1) : "0",
    };
  }, [run]);

  const meta = SECTION_META[consoleSection];

  const renderAnomalyList = (onPick: (a: Anomaly) => void) => (
    <div className="max-h-[min(70vh,520px)] space-y-2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
      {anomalies.length === 0 && (
        <div className="px-3 py-8 text-center text-sm text-slate-500">
          No anomalies yet. Go to <span className="font-medium text-slate-700">Overview</span> and run analysis on
          a CSV.
        </div>
      )}
      {anomalies.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onPick(a)}
          className={`w-full rounded-xl px-3 py-3 text-left transition hover:bg-slate-50 ${
            selected?.id === a.id ? "bg-blue-50 ring-1 ring-blue-100" : ""
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="font-mono text-xs text-slate-500">{a.order_id ?? `row ${a.row_index}`}</div>
            <Badge tone={severityTone(a.severity)}>{a.severity}</Badge>
          </div>
          <div className="mt-1 text-sm font-medium text-slate-900">{a.anomaly_type}</div>
          <div className="mt-1 line-clamp-2 text-xs text-slate-600">{a.explanation}</div>
        </button>
      ))}
    </div>
  );

  const evidencePanel = (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Details</h2>
        {selected && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Approve"
              aria-label="Approve anomaly"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 ring-emerald-100 transition hover:bg-emerald-100 hover:ring-1 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              onClick={async () => {
                try {
                  await postFeedback(selected.id, "approve");
                  setFeedbackToast({ message: "Feedback saved: approved.", tone: "success" });
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  setError(msg);
                  setFeedbackToast({ message: `Could not save feedback: ${msg}`, tone: "error" });
                }
              }}
            >
              <FeedbackThumbImage variant="up" className="h-5 w-5 opacity-90" />
            </button>
            <button
              type="button"
              title="Dismiss"
              aria-label="Dismiss anomaly"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 ring-slate-100 transition hover:bg-slate-50 hover:ring-1 focus:outline-none focus:ring-2 focus:ring-slate-400"
              onClick={async () => {
                try {
                  await postFeedback(selected.id, "dismiss");
                  setFeedbackToast({ message: "Feedback saved: dismissed.", tone: "success" });
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  setError(msg);
                  setFeedbackToast({ message: `Could not save feedback: ${msg}`, tone: "error" });
                }
              }}
            >
              <FeedbackThumbImage variant="down" className="h-5 w-5 opacity-90" />
            </button>
          </div>
        )}
      </div>
      <div className="min-h-[280px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {!run && (
          <div className="text-sm text-slate-500">
            Run an analysis from <span className="font-medium text-slate-700">Overview</span> first.
          </div>
        )}
        {run && !selected && (
          <div className="text-sm text-slate-500">Select an alert from the list to view evidence and remediation.</div>
        )}
        {selected && (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Confidence</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">
                {(selected.confidence * 100).toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Explanation</div>
              <p className="mt-1 text-sm leading-relaxed text-slate-700">{selected.explanation ?? "—"}</p>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Fact RAG · contract evidence</div>
              <ul className="mt-2 space-y-2">
                {(selected.evidence_refs ?? []).length === 0 && (
                  <li className="text-sm text-slate-500">No snippets retrieved.</li>
                )}
                {(selected.evidence_refs ?? []).map((ev, idx) => (
                  <li
                    key={idx}
                    className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                  >
                    <div className="text-xs font-semibold text-slate-900">{String(ev.title ?? "Clause")}</div>
                    <div className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{String(ev.excerpt ?? "")}</div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Solver RAG · playbook</div>
              <div className="mt-2 whitespace-pre-wrap rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-3 text-sm text-slate-800">
                {selected.remediation ?? "—"}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 flex-shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
          <div className="border-b border-slate-100 px-5 py-4">
            <div className="text-sm font-semibold text-slate-900">Billing Console</div>
            <div className="text-xs text-slate-500">Anomaly detection & RAG</div>
          </div>
          <nav className="flex flex-1 flex-col gap-1 px-3 py-4 text-sm">
            {CONSOLE_NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.hint}
                onClick={() => setConsoleSection(item.id)}
                className={`rounded-lg px-3 py-2 text-left transition ${
                  consoleSection === item.id
                    ? "bg-slate-100 font-medium text-slate-900"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            FastAPI · pgvector · GPT‑4o‑mini
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
            <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-lg font-semibold tracking-tight text-slate-900">{meta.title}</h1>
                  <p className="mt-0.5 text-sm text-slate-500">{meta.subtitle}</p>
                </div>
                <div className="hidden shrink-0 items-center gap-2 sm:flex">
                  <Badge tone="blue">HF Space</Badge>
                  <Badge tone="slate">Dual RAG</Badge>
                </div>
              </div>
              <div className="flex gap-1 overflow-x-auto pb-1 md:hidden">
                {CONSOLE_NAV.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setConsoleSection(item.id)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      consoleSection === item.id
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {error}
              </div>
            )}

            {consoleSection === "overview" && (
              <>
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">Data ingest</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Required columns: order_id, customer_id, order_date, product_id, product_name, category,
                        price, quantity, payment_method, country, city
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

                {run && run.input_preview.length > 0 && (
                  <DatasetPreviewTable rows={run.input_preview} totalRows={run.total_rows} />
                )}

                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-600">
                  <span className="font-medium text-slate-800">Next:</span> open{" "}
                  <button
                    type="button"
                    className="font-semibold text-blue-700 underline decoration-blue-200 underline-offset-2 hover:text-blue-900"
                    onClick={() => setConsoleSection("alerts")}
                  >
                    Alerts
                  </button>{" "}
                  to review findings,{" "}
                  <button
                    type="button"
                    className="font-semibold text-blue-700 underline decoration-blue-200 underline-offset-2 hover:text-blue-900"
                    onClick={() => setConsoleSection("evidence")}
                  >
                    Evidence
                  </button>{" "}
                  for RAG detail, or{" "}
                  <button
                    type="button"
                    className="font-semibold text-blue-700 underline decoration-blue-200 underline-offset-2 hover:text-blue-900"
                    onClick={() => setConsoleSection("assistant")}
                  >
                    Assistant
                  </button>{" "}
                  to ask questions.
                </div>
              </>
            )}

            {consoleSection === "alerts" && (
              <section>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">All alerts</h2>
                  <span className="text-xs text-slate-500">{anomalies.length} items</span>
                </div>
                {stats && (
                  <div className="mb-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                      <div className="text-[10px] font-medium uppercase text-slate-500">Rows</div>
                      <div className="text-lg font-semibold text-slate-900">{stats.total}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                      <div className="text-[10px] font-medium uppercase text-slate-500">Anomalies</div>
                      <div className="text-lg font-semibold text-rose-600">{stats.hits}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                      <div className="text-[10px] font-medium uppercase text-slate-500">Rate</div>
                      <div className="text-lg font-semibold text-slate-900">{stats.rate}%</div>
                    </div>
                  </div>
                )}
                {renderAnomalyList((a) => {
                  setSelected(a);
                  setConsoleSection("evidence");
                })}
              </section>
            )}

            {consoleSection === "evidence" && (
              <div className="grid gap-6 lg:grid-cols-5">
                <section className="lg:col-span-2">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-900">Pick an alert</h2>
                    <span className="text-xs text-slate-500">{anomalies.length} items</span>
                  </div>
                  {renderAnomalyList((a) => setSelected(a))}
                </section>
                <section className="lg:col-span-3">{evidencePanel}</section>
              </div>
            )}

            {consoleSection === "assistant" && (
              <section>
                <ChatAssistant />
              </section>
            )}
          </div>
        </main>
      </div>

      {feedbackToast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 right-4 z-[100] flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
            feedbackToast.tone === "success"
              ? "border-emerald-200 bg-white text-emerald-950"
              : "border-rose-200 bg-white text-rose-950"
          }`}
        >
          <span
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
              feedbackToast.tone === "success" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
            }`}
            aria-hidden
          >
            {feedbackToast.tone === "success" ? (
              <FeedbackThumbImage variant="up" className="h-4 w-4" />
            ) : (
              <IconAlertCircle className="h-3.5 w-3.5" />
            )}
          </span>
          <span className="leading-snug">{feedbackToast.message}</span>
        </div>
      )}
    </div>
  );
}

function axiosIsError(e: unknown): e is { response?: { data?: { detail?: unknown } } } {
  return typeof e === "object" && e !== null && "response" in e;
}
