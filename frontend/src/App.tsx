import type { ChangeEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { analyzeCsv, postFeedback, type AnalysisRun, type Anomaly } from "./api";
import { BrandLogoFull, BrandLogoMark, NavSectionIcon } from "./components/BrandLogo";
import ChatAssistant from "./components/ChatAssistant";
import { parseCsvForPreview } from "./csvPreview";

function Badge({ children, tone }: { children: ReactNode; tone: "red" | "amber" | "blue" | "slate" }) {
  const map = {
    red: "bg-rose-50 text-rose-700 ring-rose-100",
    amber: "bg-amber-50 text-amber-800 ring-amber-100",
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ring-1 ${map[tone]}`}>
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

function IconAnomalyCircle(props: { className?: string }) {
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

/** Map dataframe row index (matches preview row order) → one anomaly record for navigation. */
function anomalyMapByRowIndex(anomalies: Anomaly[]): Map<number, Anomaly> {
  const m = new Map<number, Anomaly>();
  for (const a of anomalies) {
    if (!m.has(a.row_index)) m.set(a.row_index, a);
  }
  return m;
}

function IconFlagFilled(props: { className?: string }) {
  return (
    <svg className={props.className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="4" y="3" width="2.25" height="18" rx="0.4" />
      <path d="M8.25 5h11.5A1.25 1.25 0 0 1 21 6.25v5.5A1.25 1.25 0 0 1 19.75 13H8.25V5z" />
    </svg>
  );
}

function IconPanelTable(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18M3 12h18M3 18h18M9 3v18M15 3v18" />
    </svg>
  );
}

function IconPanelUpload(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v12" />
      <path d="m7 8 5-5 5 5" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    </svg>
  );
}

function IconPanelBook(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
      <path d="M8 7h8M8 11h6" />
    </svg>
  );
}

type SolverRagBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "ordered"; items: string[] }
  | { kind: "bullet"; items: string[] }
  /** Single numbered title + following bullet lines, one card in the UI */
  | { kind: "step"; title: string; bullets: string[] };

/** Merge `1. Title` + bullet block into one step so the title and body share one bordered card */
function mergeRemediationSteps(blocks: SolverRagBlock[]): SolverRagBlock[] {
  const out: SolverRagBlock[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    const next = blocks[i + 1];
    if (b.kind === "ordered" && b.items.length === 1 && next?.kind === "bullet") {
      out.push({ kind: "step", title: b.items[0]!, bullets: next.items });
      i += 2;
      continue;
    }
    out.push(b);
    i++;
  }
  return out;
}

function segmentRemediation(text: string): SolverRagBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: SolverRagBlock[] = [];
  let i = 0;

  const numberedLine = (s: string) => {
    const m = s.trim().match(/^(\d+)[\.\)]\s*(.+)$/);
    return m ? m[2].trim() : null;
  };
  const bulletLine = (s: string) => {
    const m = s.trim().match(/^[-*•]\s+(.+)$/);
    return m ? m[1] : null;
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) {
      i++;
      continue;
    }

    const n = numberedLine(raw);
    if (n !== null) {
      const items: string[] = [];
      while (i < lines.length) {
        const item = numberedLine(lines[i]);
        if (item === null) break;
        items.push(item);
        i++;
      }
      blocks.push({ kind: "ordered", items });
      continue;
    }

    const b = bulletLine(raw);
    if (b !== null) {
      const items: string[] = [];
      while (i < lines.length) {
        const item = bulletLine(lines[i]);
        if (item === null) break;
        items.push(item);
        i++;
      }
      blocks.push({ kind: "bullet", items });
      continue;
    }

    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const t = lines[i];
      const tr = t.trim();
      if (!tr) break;
      if (numberedLine(t) !== null || bulletLine(t) !== null) break;
      para.push(tr);
      i++;
    }
    blocks.push({ kind: "paragraph", text: para.join(" ") });
  }

  return mergeRemediationSteps(blocks);
}

function SolverRagInlineEmphasis({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, idx) => {
        const m = p.match(/^\*\*(.+)\*\*$/);
        if (m) {
          return (
            <strong key={idx} className="font-semibold text-blue-950">
              {m[1]}
            </strong>
          );
        }
        return <span key={idx}>{p}</span>;
      })}
    </>
  );
}

function IconSolverRag(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  );
}

/** Solver RAG remediation — same card pattern as Fact RAG in this file */
function SolverRagOutput({ content }: { content: string | null }) {
  const blocks = useMemo(() => {
    if (!content?.trim()) return [];
    return segmentRemediation(content.trim());
  }, [content]);

  const fallbackPlain = Boolean(content?.trim()) && blocks.length === 0;

  if (!content?.trim()) {
    return (
      <div>
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-sm">
            <IconSolverRag className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-blue-950">Solver RAG</div>
            <div className="text-xs text-blue-800/60">Remediation playbook</div>
          </div>
        </div>
        <div className="rounded-lg border border-dashed border-blue-100/80 bg-blue-50/30 px-3 py-2 text-sm text-slate-500">
          No remediation text for this anomaly.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-sm">
          <IconSolverRag className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-blue-950">Solver RAG</div>
          <div className="text-xs text-blue-800/60">Remediation playbook</div>
        </div>
      </div>

      <ul className="space-y-2">
        {fallbackPlain && (
          <li className="rounded-xl border border-blue-100/40 bg-gradient-to-br from-white to-blue-50/25 px-3 py-2.5 text-sm text-slate-700 shadow-sm ring-1 ring-blue-100/30">
            <div className="whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{content}</div>
          </li>
        )}
        {!fallbackPlain &&
          blocks.map((block, bi) => {
            if (block.kind === "step") {
              const stepOrdinal =
                blocks.slice(0, bi).filter((x) => x.kind === "step").length + 1;
              return (
                <li
                  key={bi}
                  className="overflow-hidden rounded-xl border border-blue-100/40 bg-gradient-to-br from-white to-blue-50/25 text-sm shadow-sm ring-1 ring-blue-100/30"
                >
                  <div className="flex items-start gap-2.5 border-b border-blue-100/40 bg-blue-50/50 px-3 py-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[9px] font-bold text-blue-700">
                      {stepOrdinal}
                    </span>
                    <div className="min-w-0 flex-1 font-semibold leading-snug text-slate-800">
                      <SolverRagInlineEmphasis text={block.title} />
                    </div>
                  </div>
                  <div className="px-3 py-2.5">
                    <ul className="space-y-1.5">
                      {block.bullets.map((item, ii) => (
                        <li key={ii} className="flex gap-2 text-xs leading-relaxed text-slate-600">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" aria-hidden />
                          <SolverRagInlineEmphasis text={item} />
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              );
            }
            if (block.kind === "paragraph") {
              return (
                <li
                  key={bi}
                  className="rounded-xl border border-blue-100/40 bg-gradient-to-br from-white to-blue-50/25 px-3 py-2.5 text-sm text-slate-700 shadow-sm ring-1 ring-blue-100/30"
                >
                  <div className="whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
                    <SolverRagInlineEmphasis text={block.text} />
                  </div>
                </li>
              );
            }
            if (block.kind === "ordered") {
              return (
                <li
                  key={bi}
                  className="rounded-xl border border-blue-100/40 bg-gradient-to-br from-white to-blue-50/25 px-3 py-2.5 text-sm shadow-sm ring-1 ring-blue-100/30"
                >
                  <ol className="list-none space-y-2 border-l-2 border-blue-200/70 pl-3">
                    {block.items.map((item, ii) => (
                      <li key={ii} className="relative pl-1 text-xs leading-relaxed text-slate-600">
                        <span className="absolute -left-[1.35rem] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-100 text-[9px] font-bold text-blue-700">
                          {ii + 1}
                        </span>
                        <SolverRagInlineEmphasis text={item} />
                      </li>
                    ))}
                  </ol>
                </li>
              );
            }
            return (
              <li
                key={bi}
                className="rounded-xl border border-blue-100/40 bg-gradient-to-br from-white to-blue-50/25 px-3 py-2.5 text-sm shadow-sm ring-1 ring-blue-100/30"
              >
                <ul className="space-y-1.5">
                  {block.items.map((item, ii) => (
                    <li key={ii} className="flex gap-2 text-xs leading-relaxed text-slate-600">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" aria-hidden />
                      <SolverRagInlineEmphasis text={item} />
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
      </ul>
    </div>
  );
}

function DatasetPreviewTable({
  rows,
  totalRows,
  anomalyByRowIndex,
  onAnomalyFlagClick,
}: {
  rows: Record<string, unknown>[];
  totalRows: number;
  /** When set, preview row index i matches server `row_index` for the same CSV row after analysis. */
  anomalyByRowIndex?: Map<number, Anomaly> | null;
  onAnomalyFlagClick?: (a: Anomaly) => void;
}) {
  if (rows.length === 0) return null;
  const cols = Object.keys(rows[0] ?? {});
  const showFlagCol = Boolean(anomalyByRowIndex?.size && onAnomalyFlagClick);
  return (
    <section className="app-panel app-panel-blue">
      <div className="app-panel-bar" aria-hidden />
      <div className="app-panel-body">
        <div className="mb-4 flex items-start gap-3 border-b border-blue-100/60 pb-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-md shadow-blue-500/30">
            <IconPanelTable className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-blue-950">Input dataset</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              Preview of uploaded CSV — showing {rows.length} of {totalRows} row{totalRows === 1 ? "" : "s"} (capped for
              performance).
              {showFlagCol && (
                <span>
                  {" "}
                  <span className="font-medium text-blue-900/80">Red flags</span> mark rows detected as anomalies;
                  click a flag to open that row in Anomalies.
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="max-h-[min(60vh,520px)] overflow-auto rounded-xl border border-blue-100/40 bg-white/60 shadow-inner shadow-blue-950/[0.02]">
        <table className="w-full min-w-max border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-gradient-to-b from-blue-50/90 to-slate-50/95 shadow-sm">
            <tr>
              {showFlagCol && (
                <th
                  scope="col"
                  className="w-12 border-b border-slate-200 px-1 py-2.5 text-center font-semibold text-slate-500"
                  title="Anomaly flag"
                >
                  <span className="sr-only">Anomaly</span>
                </th>
              )}
              {cols.map((c) => (
                <th
                  key={c}
                  className="whitespace-nowrap border-b border-slate-200 px-3 py-2.5 font-semibold text-slate-800"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-slate-700">
            {rows.map((r, i) => {
              const flagged = showFlagCol ? anomalyByRowIndex?.get(i) : undefined;
              return (
                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/80">
                  {showFlagCol && (
                    <td className="w-12 px-1 py-2 align-middle text-center">
                      {flagged ? (
                        <button
                          type="button"
                          onClick={() => onAnomalyFlagClick?.(flagged)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-rose-600 transition hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-400/60"
                          title={`${flagged.anomaly_type} — open in Anomalies`}
                          aria-label={`Open anomaly for row ${flagged.row_index} in Anomalies`}
                        >
                          <IconFlagFilled className="h-5 w-5 drop-shadow-sm" />
                        </button>
                      ) : (
                        <span className="inline-block h-8 w-8" aria-hidden />
                      )}
                    </td>
                  )}
                  {cols.map((c) => (
                    <td key={c} className="max-w-[16rem] truncate px-3 py-2 align-top font-mono text-sm">
                      {formatDatasetCell(r[c])}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </section>
  );
}

type ConsoleSection = "overview" | "anomalies" | "evidence" | "assistant";

const SECTION_META: Record<ConsoleSection, { title: string; subtitle: string }> = {
  overview: {
    title: "Overview",
    subtitle: "Ingest billing data, inspect the loaded dataset, and see run metrics.",
  },
  anomalies: {
    title: "Anomalies",
    subtitle: "Browse detected anomalies from the latest analysis run.",
  },
  evidence: {
    title: "Evidence & remediation",
    subtitle: "Contract evidence, solver playbook, and human feedback on each anomaly.",
  },
  assistant: {
    title: "Assistant",
    subtitle: "Ask questions about anomalies, contracts, and recent runs — streaming GPT‑4o‑mini.",
  },
};

const CONSOLE_NAV: { id: ConsoleSection; label: string; hint: string }[] = [
  { id: "overview", label: "Overview", hint: "Upload, stats, dataset" },
  { id: "anomalies", label: "Anomalies", hint: "Anomaly list" },
  { id: "evidence", label: "Evidence", hint: "RAG evidence & actions" },
  { id: "assistant", label: "Assistant", hint: "NLP chat" },
];

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  /** Parsed locally when a CSV is chosen (before Run analysis). */
  const [csvPreview, setCsvPreview] = useState<{
    rows: Record<string, unknown>[];
    totalRows: number;
  } | null>(null);
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

  const onCsvFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setCsvPreview(null);
    setRun(null);
    setSelected(null);
    if (!f) {
      setError(null);
      return;
    }
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setError("Please choose a .csv file.");
      return;
    }
    try {
      const text = await f.text();
      const parsed = parseCsvForPreview(text);
      if (!parsed || parsed.rows.length === 0) {
        setError("Could not parse CSV (empty or missing header row).");
        return;
      }
      setCsvPreview(parsed);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read file");
    }
  }, []);

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

  const datasetPreview = useMemo(() => {
    if (run?.input_preview?.length) {
      return { rows: run.input_preview, totalRows: run.total_rows };
    }
    if (csvPreview?.rows.length) {
      return { rows: csvPreview.rows, totalRows: csvPreview.totalRows };
    }
    return null;
  }, [run, csvPreview]);

  /** Preview rows are `df.head(200)` from the run — row index `i` matches `Anomaly.row_index`. */
  const anomalyByRowForPreview = useMemo(() => {
    if (!run?.anomalies?.length || !datasetPreview) return null;
    const m = anomalyMapByRowIndex(run.anomalies);
    const n = datasetPreview.rows.length;
    for (const idx of m.keys()) {
      if (idx >= 0 && idx < n) return m;
    }
    return null;
  }, [run?.anomalies, datasetPreview]);

  const navigateToAnomalyFromPreview = useCallback((a: Anomaly) => {
    setSelected(a);
    setConsoleSection("anomalies");
  }, []);

  const meta = SECTION_META[consoleSection];

  const renderAnomalyList = (onPick: (a: Anomaly) => void) => (
    <div className="app-panel max-h-[min(70vh,520px)] space-y-2 overflow-y-auto p-2">
      {anomalies.length === 0 && (
        <div className="px-3 py-8 text-center text-sm text-slate-500">
          No anomalies yet. Go to <span className="font-medium text-blue-900/80">Overview</span> and run analysis on
          a CSV.
        </div>
      )}
      {anomalies.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onPick(a)}
          className={`w-full rounded-xl px-3 py-3 text-left transition hover:bg-blue-50/50 ${
            selected?.id === a.id ? "bg-blue-50/90 shadow-sm ring-1 ring-blue-200/70" : ""
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
        <h2 className="text-base font-semibold tracking-tight text-blue-950">Details</h2>
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
      <div className="app-panel app-panel-blue min-h-[280px]">
        <div className="app-panel-bar" aria-hidden />
        <div className="app-panel-body space-y-5">
        {!run && (
          <div className="text-sm text-slate-600">
            Run an analysis from <span className="font-medium text-blue-900/90">Overview</span> first.
          </div>
        )}
        {run && !selected && (
          <div className="text-sm text-slate-600">Select an anomaly from the list to view evidence and remediation.</div>
        )}
        {selected && (
          <>
            <div className="rounded-xl border border-blue-100/50 bg-white/70 px-4 py-3 shadow-inner shadow-blue-950/[0.02]">
              <div className="app-section-label">Confidence</div>
              <div className="mt-1 bg-gradient-to-br from-slate-800 to-blue-800 bg-clip-text text-2xl font-semibold text-transparent">
                {(selected.confidence * 100).toFixed(1)}%
              </div>
            </div>
            <div className="rounded-xl border border-blue-100/40 bg-white/60 px-4 py-3">
              <div className="app-section-label">Explanation</div>
              <p className="mt-2 text-sm leading-relaxed text-slate-700">{selected.explanation ?? "—"}</p>
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-sm">
                  <IconPanelBook className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-blue-950">Fact RAG</div>
                  <div className="text-xs text-blue-800/60">Contract evidence</div>
                </div>
              </div>
              <ul className="space-y-2">
                {(selected.evidence_refs ?? []).length === 0 && (
                  <li className="rounded-lg border border-dashed border-blue-100/80 bg-blue-50/30 px-3 py-2 text-sm text-slate-500">
                    No snippets retrieved.
                  </li>
                )}
                {(selected.evidence_refs ?? []).map((ev, idx) => (
                  <li
                    key={idx}
                    className="rounded-xl border border-blue-100/40 bg-gradient-to-br from-white to-blue-50/25 px-3 py-2.5 text-sm text-slate-700 shadow-sm ring-1 ring-blue-100/30"
                  >
                    <div className="text-xs font-semibold text-blue-950">{String(ev.title ?? "Clause")}</div>
                    <div className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{String(ev.excerpt ?? "")}</div>
                  </li>
                ))}
              </ul>
            </div>
            <SolverRagOutput content={selected.remediation} />
          </>
        )}
        </div>
      </div>
    </>
  );

  return (
    <div className="app-backdrop min-h-screen text-slate-900">
      <div className="flex min-h-screen">
        <aside className="app-sidebar-shell hidden w-[17rem] flex-shrink-0 flex-col md:flex">
          <div className="border-b border-slate-100/90 px-5 py-6">
            <BrandLogoFull />
          </div>
          <nav className="flex flex-1 flex-col gap-1 px-3 py-4 text-base" aria-label="Primary">
            {CONSOLE_NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.hint}
                onClick={() => setConsoleSection(item.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 focus-visible:ring-offset-2 ${
                  consoleSection === item.id
                    ? "bg-blue-50 font-medium text-blue-950 shadow-sm ring-1 ring-blue-100/90"
                    : "text-slate-600 hover:bg-slate-50/90 hover:text-slate-900"
                }`}
              >
                <NavSectionIcon id={item.id} />
                {item.label}
              </button>
            ))}
          </nav>
          <div className="border-t border-slate-100/90 px-5 py-4 text-xs leading-relaxed text-slate-500">
            FastAPI · pgvector · GPT‑4o‑mini
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="app-header-shell">
            <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-5 sm:px-7">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
                  <BrandLogoMark size={38} className="shrink-0 shadow-md shadow-blue-500/20 md:hidden" />
                  <div className="min-w-0">
                    <h1 className="text-xl font-semibold tracking-tight text-slate-900">{meta.title}</h1>
                    <p className="mt-1 text-base leading-relaxed text-slate-500">{meta.subtitle}</p>
                  </div>
                </div>
                <div className="hidden shrink-0 items-center gap-2 sm:flex">
                  <Badge tone="blue">HF Space</Badge>
                  <Badge tone="slate">Dual RAG</Badge>
                </div>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 md:hidden" role="tablist" aria-label="Sections">
                {CONSOLE_NAV.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setConsoleSection(item.id)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 ${
                      consoleSection === item.id
                        ? "bg-blue-600 text-white shadow-md shadow-blue-500/25"
                        : "bg-white/90 text-slate-600 shadow-sm ring-1 ring-slate-200/80 hover:bg-slate-50"
                    }`}
                  >
                    <NavSectionIcon id={item.id} className="h-4 w-4 shrink-0 opacity-95" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </header>

          <div className="mx-auto max-w-6xl space-y-7 px-5 py-7 sm:px-7">
            {error && (
              <div className="app-panel border-rose-200/70 bg-gradient-to-br from-rose-50/95 to-white px-4 py-3.5 text-sm text-rose-900 shadow-sm ring-rose-100/60">
                {error}
              </div>
            )}

            {consoleSection === "overview" && (
              <>
                <section className="app-panel app-panel-blue">
                  <div className="app-panel-bar" aria-hidden />
                  <div className="app-panel-body">
                    <div className="mb-3 flex flex-col gap-4 border-b border-blue-100/60 pb-4 sm:flex-row sm:items-end sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-md shadow-blue-500/30">
                          <IconPanelUpload className="h-5 w-5" />
                        </div>
                        <div>
                          <h2 className="text-base font-semibold tracking-tight text-blue-950">Data ingest</h2>
                          <p className="mt-1 text-sm leading-relaxed text-slate-600">
                            Required columns: order_id, customer_id, order_date, product_id, product_name, category,
                            price, quantity, payment_method, country, city
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 sm:pl-0">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-blue-100/80 bg-white/80 px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm ring-1 ring-blue-100/50 transition hover:border-blue-200 hover:bg-white">
                          <input
                            type="file"
                            accept=".csv"
                            className="hidden"
                            onChange={onCsvFileChange}
                          />
                          Choose CSV
                        </label>
                        <button
                          type="button"
                          onClick={onUpload}
                          disabled={loading}
                          className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-500/25 transition hover:from-blue-700 hover:to-blue-800 disabled:opacity-60"
                        >
                          {loading ? "Analyzing…" : "Run analysis"}
                        </button>
                      </div>
                    </div>
                    {file && (
                      <div className="rounded-xl border border-blue-100/50 bg-blue-50/40 px-3 py-2 text-xs text-slate-700">
                        Selected: <span className="font-mono">{file.name}</span>
                      </div>
                    )}
                  </div>
                </section>

                {stats && (
                  <section className="grid gap-4 sm:grid-cols-3">
                    <div className="app-panel p-5">
                      <div className="app-section-label">Rows processed</div>
                      <div className="mt-2 bg-gradient-to-br from-slate-800 to-slate-600 bg-clip-text text-2xl font-semibold text-transparent">
                        {stats.total}
                      </div>
                    </div>
                    <div className="app-panel p-5 ring-rose-100/50">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-rose-600/90">Anomalies</div>
                      <div className="mt-2 text-2xl font-semibold text-rose-600">{stats.hits}</div>
                    </div>
                    <div className="app-panel p-5">
                      <div className="app-section-label">Anomaly rate</div>
                      <div className="mt-2 bg-gradient-to-br from-blue-700 to-blue-600 bg-clip-text text-2xl font-semibold text-transparent">
                        {stats.rate}%
                      </div>
                    </div>
                  </section>
                )}

                {datasetPreview && (
                  <DatasetPreviewTable
                    rows={datasetPreview.rows}
                    totalRows={datasetPreview.totalRows}
                    anomalyByRowIndex={anomalyByRowForPreview}
                    onAnomalyFlagClick={navigateToAnomalyFromPreview}
                  />
                )}

                <div className="app-panel app-panel-blue">
                  <div className="app-panel-bar" aria-hidden />
                  <div className="app-panel-body py-4 text-sm leading-relaxed text-slate-600">
                    <span className="font-semibold text-blue-950">Next:</span> open{" "}
                    <button
                      type="button"
                      className="font-semibold text-blue-700 underline decoration-blue-200/80 underline-offset-2 transition hover:text-blue-900"
                      onClick={() => setConsoleSection("anomalies")}
                    >
                      Anomalies
                    </button>{" "}
                    to review findings,{" "}
                    <button
                      type="button"
                      className="font-semibold text-blue-700 underline decoration-blue-200/80 underline-offset-2 transition hover:text-blue-900"
                      onClick={() => setConsoleSection("evidence")}
                    >
                      Evidence
                    </button>{" "}
                    for RAG detail, or{" "}
                    <button
                      type="button"
                      className="font-semibold text-blue-700 underline decoration-blue-200/80 underline-offset-2 transition hover:text-blue-900"
                      onClick={() => setConsoleSection("assistant")}
                    >
                      Assistant
                    </button>{" "}
                    to ask questions.
                  </div>
                </div>
              </>
            )}

            {consoleSection === "anomalies" && (
              <section>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold tracking-tight text-blue-950">All anomalies</h2>
                  <span className="text-xs text-slate-500">{anomalies.length} items</span>
                </div>
                {stats && (
                  <div className="mb-4 grid gap-3 sm:grid-cols-3">
                    <div className="app-panel px-3 py-2.5">
                      <div className="app-section-label">Rows</div>
                      <div className="text-lg font-semibold text-slate-900">{stats.total}</div>
                    </div>
                    <div className="app-panel px-3 py-2.5 ring-rose-100/40">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-rose-600/90">Anomalies</div>
                      <div className="text-lg font-semibold text-rose-600">{stats.hits}</div>
                    </div>
                    <div className="app-panel px-3 py-2.5">
                      <div className="app-section-label">Rate</div>
                      <div className="text-lg font-semibold text-blue-800">{stats.rate}%</div>
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
                    <h2 className="text-base font-semibold tracking-tight text-blue-950">Pick an anomaly</h2>
                    <span className="text-xs text-slate-500">{anomalies.length} items</span>
                  </div>
                  {renderAnomalyList((a) => setSelected(a))}
                </section>
                <section className="lg:col-span-3">{evidencePanel}</section>
              </div>
            )}

            {consoleSection === "assistant" && (
              <section className="flex min-h-[calc(100vh-12rem)] flex-col">
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
          className={`fixed bottom-4 right-4 z-[100] flex max-w-sm items-start gap-3 rounded-2xl px-4 py-3 text-sm shadow-lg ring-1 ${
            feedbackToast.tone === "success"
              ? "border border-emerald-200/80 bg-gradient-to-br from-white to-emerald-50/40 text-emerald-950 ring-emerald-100/60"
              : "border border-rose-200/80 bg-gradient-to-br from-white to-rose-50/40 text-rose-950 ring-rose-100/60"
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
              <IconAnomalyCircle className="h-3.5 w-3.5" />
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
