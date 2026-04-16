import type { MouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  nlpQueryStream,
  type ChatMessageIn,
} from "../api";
import {
  loadSessions,
  newSession,
  saveSessions,
  sessionTitleFromMessages,
  type ChatSession,
} from "../chatSessions";

function formatChatTime(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const initialSessions = (() => {
  const s = loadSessions();
  return s.length ? s : [newSession()];
})();

export default function ChatAssistant() {
  const [sessions, setSessions] = useState<ChatSession[]>(initialSessions);
  const [activeId, setActiveId] = useState(() => initialSessions[0].id);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMeta, setLastMeta] = useState<{
    intent: string;
    sql_used: string | null;
  } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? sessions[0],
    [sessions, activeId]
  );

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages, busy]);

  const updateActive = useCallback(
    (fn: (s: ChatSession) => ChatSession) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === activeId ? fn(s) : s))
      );
    },
    [activeId]
  );

  const onNewChat = () => {
    const s = newSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setInput("");
    setError(null);
    setLastMeta(null);
  };

  const onSelectSession = (id: string) => {
    setActiveId(id);
    setError(null);
    setLastMeta(null);
  };

  const onDeleteSession = useCallback(
    (e: MouseEvent, id: string) => {
      e.stopPropagation();
      e.preventDefault();
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === id);
        const next = prev.filter((s) => s.id !== id);
        if (next.length === 0) {
          const fresh = newSession();
          setActiveId(fresh.id);
          setInput("");
          setError(null);
          setLastMeta(null);
          return [fresh];
        }
        if (id === activeId) {
          const newActive = next[idx] ?? next[idx - 1] ?? next[0];
          setActiveId(newActive.id);
          setInput("");
          setError(null);
          setLastMeta(null);
        }
        return next;
      });
    },
    [activeId]
  );

  const onSend = async () => {
    const q = input.trim();
    if (!q || busy || !active) return;
    setBusy(true);
    setError(null);
    setLastMeta(null);
    const prior = active.messages;
    const historyApi: ChatMessageIn[] = prior.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setInput("");
    updateActive((s) => ({
      ...s,
      messages: [...s.messages, { role: "user", content: q }, { role: "assistant", content: "" }],
      updatedAt: Date.now(),
      title: sessionTitleFromMessages([...s.messages, { role: "user", content: q }]),
    }));

    try {
      await nlpQueryStream(q, historyApi, active.id, (ev) => {
        if ("meta" in ev && ev.meta) {
          setLastMeta(ev.meta);
          return;
        }
        if ("delta" in ev && typeof ev.delta === "string" && ev.delta) {
          const d = ev.delta;
          updateActive((s) => {
            const msgs = [...s.messages];
            const last = msgs.length - 1;
            if (last >= 0 && msgs[last].role === "assistant") {
              msgs[last] = {
                role: "assistant",
                content: msgs[last].content + d,
              };
            }
            return {
              ...s,
              messages: msgs,
              updatedAt: Date.now(),
            };
          });
        }
        if ("error" in ev && typeof ev.error === "string") {
          const err = ev.error;
          setError(err);
          updateActive((s) => {
            const msgs = [...s.messages];
            const last = msgs.length - 1;
            if (last >= 0 && msgs[last].role === "assistant") {
              msgs[last] = {
                role: "assistant",
                content: msgs[last].content || `Error: ${err}`,
              };
            }
            return { ...s, messages: msgs, updatedAt: Date.now() };
          });
        }
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      updateActive((s) => {
        const msgs = [...s.messages];
        const last = msgs.length - 1;
        if (last >= 0 && msgs[last].role === "assistant") {
          msgs[last] = {
            role: "assistant",
            content: msgs[last].content || `Error: ${msg}`,
          };
        }
        return { ...s, messages: msgs, updatedAt: Date.now() };
      });
    } finally {
      setBusy(false);
    }
  };

  const msgs = active?.messages ?? [];

  return (
    <div className="flex w-full flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06),0_8px_24px_-4px_rgba(15,23,42,0.08)] ring-1 ring-slate-900/[0.04] min-h-[min(72vh,calc(100vh-11rem))] lg:flex-row lg:min-h-[min(640px,calc(100vh-12rem))]">
      <aside className="flex max-h-44 flex-shrink-0 flex-col border-b border-slate-200/90 bg-gradient-to-b from-slate-50 to-slate-50/70 p-3 lg:max-h-none lg:w-64 lg:min-w-[14rem] lg:border-b-0 lg:border-r lg:p-4">
        <div className="mb-2 hidden text-[10px] font-semibold uppercase tracking-wider text-slate-400 lg:block">
          Conversations
        </div>
        <button
          type="button"
          onClick={onNewChat}
          className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-slate-900 text-white">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3 w-3" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          New conversation
        </button>
        <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex min-w-0 items-stretch gap-0.5 rounded-xl transition ${
                s.id === activeId
                  ? "bg-white shadow-md ring-1 ring-slate-200/90"
                  : "hover:bg-white/90"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectSession(s.id)}
                className={`min-w-0 flex-1 rounded-xl px-3 py-2.5 text-left text-sm ${
                  s.id === activeId ? "font-medium text-slate-900" : "text-slate-600"
                }`}
              >
                <div className="line-clamp-2 leading-snug">{s.title}</div>
                <div className="mt-1 text-[11px] tabular-nums text-slate-400">
                  {formatChatTime(s.updatedAt)}
                </div>
              </button>
              <button
                type="button"
                title="Delete session"
                aria-label={`Delete session: ${s.title}`}
                onClick={(e) => onDeleteSession(e, s.id)}
                className="flex shrink-0 items-center justify-center rounded-xl px-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="h-4 w-4"
                  aria-hidden
                >
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col bg-white">
        <div className="border-b border-slate-100 bg-white px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold tracking-tight text-slate-900">Billing assistant</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
                Natural language over your analysis runs, anomaly records, and contract clauses. Responses stream in
                real time.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                GPT‑4o‑mini
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                Local sessions
              </span>
            </div>
          </div>
          {lastMeta && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 text-[11px]">
              <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 font-mono text-slate-700">
                intent · {lastMeta.intent}
              </span>
              {lastMeta.sql_used && (
                <span className="max-w-full rounded-lg bg-emerald-50 px-2.5 py-1 font-mono text-emerald-900 ring-1 ring-emerald-100/80">
                  {lastMeta.sql_used}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_12%)] px-4 py-5 sm:px-6">
          {msgs.length === 0 && !busy && (
            <div className="mx-auto max-w-xl rounded-2xl border border-slate-200/80 bg-white px-6 py-10 text-center shadow-sm">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-6 w-6" aria-hidden>
                  <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <p className="text-base font-semibold text-slate-900">Start a conversation</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Ask about anomalies, database counts, high-severity alerts, or contract language (e.g. refunds).
              </p>
            </div>
          )}

          <div className="mx-auto max-w-3xl space-y-5">
            {msgs.map((m, i) => (
              <div
                key={i}
                className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    m.role === "user"
                      ? "bg-slate-800 text-white"
                      : "border border-slate-200 bg-white text-slate-600 shadow-sm"
                  }`}
                  aria-hidden
                >
                  {m.role === "user" ? "You" : "AI"}
                </div>
                <div className={`min-w-0 max-w-[min(100%,36rem)] ${m.role === "user" ? "text-right" : ""}`}>
                  <div
                    className={`inline-block rounded-2xl px-4 py-3 text-[15px] leading-relaxed shadow-sm ${
                      m.role === "user"
                        ? "bg-slate-900 text-left text-white"
                        : "border border-slate-200/90 bg-white text-left text-slate-800"
                    }`}
                  >
                    {m.role === "assistant" ? (
                      <div className="whitespace-pre-wrap break-words">
                        {m.content || (busy && i === msgs.length - 1 ? "…" : "")}
                      </div>
                    ) : (
                      m.content
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div ref={bottomRef} />
        </div>

        {error && (
          <div className="border-t border-rose-200/80 bg-rose-50 px-5 py-3 text-sm text-rose-900">
            {error}
          </div>
        )}

        <div className="border-t border-slate-200/90 bg-slate-50/80 px-4 py-4 sm:px-6">
          <div className="mx-auto flex max-w-3xl gap-3">
            <textarea
              rows={2}
              className="max-h-40 min-h-[52px] flex-1 resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[15px] text-slate-900 shadow-inner shadow-slate-900/5 outline-none ring-slate-200/80 placeholder:text-slate-400 focus:border-slate-300 focus:ring-2 focus:ring-slate-900/10"
              placeholder="Ask a question about your billing data…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSend();
                }
              }}
              disabled={busy}
            />
            <button
              type="button"
              onClick={() => void onSend()}
              disabled={busy || !input.trim()}
              className="inline-flex shrink-0 items-center justify-center gap-2 self-end rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-45"
            >
              {busy ? (
                <span className="text-lg leading-none">…</span>
              ) : (
                <>
                  <span>Send</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden>
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                  </svg>
                </>
              )}
            </button>
          </div>
          <p className="mx-auto mt-3 max-w-3xl text-center text-[11px] text-slate-400">
            Enter to send · Shift+Enter for newline · Sessions stored in this browser only
          </p>
        </div>
      </div>
    </div>
  );
}
