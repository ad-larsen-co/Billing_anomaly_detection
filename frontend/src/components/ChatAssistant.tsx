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
    <div className="app-panel app-panel-blue flex min-h-[min(72vh,calc(100vh-11rem))] w-full flex-1 flex-col overflow-hidden rounded-3xl lg:min-h-[min(640px,calc(100vh-12rem))] lg:flex-row">
      <div className="app-panel-bar" aria-hidden />
      <aside className="flex max-h-44 flex-shrink-0 flex-col border-b border-blue-100/50 bg-gradient-to-b from-blue-50/40 via-slate-50/80 to-slate-50/50 p-4 lg:max-h-none lg:w-[17.5rem] lg:min-w-[15rem] lg:border-b-0 lg:border-r lg:border-blue-100/40 lg:p-5">
        <div className="mb-2 hidden text-xs font-semibold uppercase tracking-wider text-blue-800/45 lg:block">
          Conversations
        </div>
        <button
          type="button"
          onClick={onNewChat}
          className="flex items-center justify-center gap-2.5 rounded-xl border border-blue-100/80 bg-white/90 px-4 py-3 text-left text-base font-semibold text-blue-950 shadow-sm ring-1 ring-blue-100/40 transition hover:border-blue-200 hover:bg-white"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5" aria-hidden>
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
                  ? "bg-white shadow-md ring-1 ring-blue-200/70"
                  : "hover:bg-white/90"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectSession(s.id)}
                className={`min-w-0 flex-1 rounded-xl px-3 py-3 text-left text-base ${
                  s.id === activeId ? "font-medium text-blue-950" : "text-blue-800/75"
                }`}
              >
                <div className="line-clamp-2 leading-snug">{s.title}</div>
                <div className="mt-1 text-xs tabular-nums text-blue-400/90">
                  {formatChatTime(s.updatedAt)}
                </div>
              </button>
              <button
                type="button"
                title="Delete session"
                aria-label={`Delete session: ${s.title}`}
                onClick={(e) => onDeleteSession(e, s.id)}
                className="flex shrink-0 items-center justify-center rounded-xl px-2.5 text-blue-400/80 transition hover:bg-rose-50 hover:text-rose-600"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="h-5 w-5"
                  aria-hidden
                >
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14zM10 11v6M14 11v6" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col bg-gradient-to-br from-white via-white to-blue-50/20">
        <div className="border-b border-blue-100/50 bg-white/80 px-6 py-5 backdrop-blur-[2px]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-blue-950">Billing assistant</h2>
              <p className="mt-1.5 max-w-2xl text-base leading-relaxed text-blue-900/65">
                Natural language over your analysis runs, anomaly records, and contract clauses. Responses stream in
                real time.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-blue-100/80 bg-blue-50/50 px-3 py-1.5 text-xs font-medium text-blue-900/75">
                GPT‑4o‑mini
              </span>
              <span className="rounded-full border border-blue-100/80 bg-blue-50/50 px-3 py-1.5 text-xs font-medium text-blue-900/75">
                Local sessions
              </span>
            </div>
          </div>
          {lastMeta && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-blue-100/60 pt-4 text-xs">
              <span className="inline-flex items-center rounded-lg bg-blue-50/80 px-3 py-1.5 font-mono text-blue-900/80">
                intent · {lastMeta.intent}
              </span>
              {lastMeta.sql_used && (
                <span className="max-w-full rounded-lg bg-emerald-50 px-3 py-1.5 font-mono text-emerald-900 ring-1 ring-emerald-100/80">
                  {lastMeta.sql_used}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto bg-gradient-to-b from-blue-50/25 via-white to-white px-5 py-6 sm:px-7">
          {msgs.length === 0 && !busy && (
            <div className="mx-auto max-w-xl rounded-2xl border border-blue-100/80 bg-white/90 px-7 py-11 text-center shadow-sm ring-1 ring-blue-100/40">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100/80 text-blue-600">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-7 w-7" aria-hidden>
                  <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <p className="text-lg font-semibold text-blue-950">Start a conversation</p>
              <p className="mt-3 text-base leading-relaxed text-blue-800/60">
                Ask about anomalies, database counts, high-severity alerts, or contract language (e.g. refunds).
              </p>
            </div>
          )}

          <div className="mx-auto max-w-3xl space-y-6">
            {msgs.map((m, i) => (
              <div
                key={i}
                className={`flex gap-3.5 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    m.role === "user"
                      ? "bg-gradient-to-br from-blue-700 to-blue-800 text-white shadow-sm"
                      : "border border-blue-200/80 bg-white text-blue-700 shadow-sm"
                  }`}
                  aria-hidden
                >
                  {m.role === "user" ? "You" : "AI"}
                </div>
                <div className={`min-w-0 max-w-[min(100%,36rem)] ${m.role === "user" ? "text-right" : ""}`}>
                  <div
                    className={`inline-block rounded-2xl px-5 py-3.5 text-base leading-relaxed shadow-sm ${
                      m.role === "user"
                        ? "bg-gradient-to-br from-blue-700 to-blue-900 text-left text-white shadow-md shadow-blue-900/15"
                        : "border border-blue-100/90 bg-white text-left text-blue-950 ring-1 ring-blue-100/50"
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
          <div className="border-t border-rose-200/80 bg-rose-50 px-6 py-4 text-base text-rose-900">
            {error}
          </div>
        )}

        <div className="border-t border-blue-100/60 bg-blue-50/30 px-5 py-5 sm:px-7">
          <div className="mx-auto flex max-w-3xl gap-3.5">
            <textarea
              rows={2}
              className="max-h-40 min-h-[56px] flex-1 resize-y rounded-2xl border border-blue-200/80 bg-white px-5 py-3.5 text-base text-blue-950 shadow-inner shadow-blue-950/5 outline-none ring-blue-100/60 placeholder:text-blue-400/80 placeholder:text-base focus:border-blue-300 focus:ring-2 focus:ring-blue-500/25"
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
              className="inline-flex shrink-0 items-center justify-center gap-2 self-end rounded-2xl bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-3.5 text-base font-semibold text-white shadow-md shadow-blue-500/25 transition hover:from-blue-700 hover:to-blue-800 disabled:opacity-45"
            >
              {busy ? (
                <span className="text-xl leading-none">…</span>
              ) : (
                <>
                  <span>Send</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" aria-hidden>
                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                  </svg>
                </>
              )}
            </button>
          </div>
          <p className="mx-auto mt-4 max-w-3xl text-center text-xs text-blue-400/90">
            Enter to send · Shift+Enter for newline · Sessions stored in this browser only
          </p>
        </div>
      </div>
    </div>
  );
}
