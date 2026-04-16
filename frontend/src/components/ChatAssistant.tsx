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
    <div className="flex min-h-[480px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:flex-row">
      <aside className="flex max-h-40 flex-shrink-0 flex-col gap-1 border-b border-slate-200 bg-slate-50 p-2 lg:max-h-none lg:w-52 lg:border-b-0 lg:border-r">
        <button
          type="button"
          onClick={onNewChat}
          className="rounded-xl bg-slate-900 px-3 py-2 text-left text-xs font-semibold text-white hover:bg-slate-800"
        >
          + New chat
        </button>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelectSession(s.id)}
              className={`w-full rounded-lg px-2 py-2 text-left text-xs transition ${
                s.id === activeId
                  ? "bg-white font-medium text-slate-900 shadow-sm ring-1 ring-slate-200"
                  : "text-slate-600 hover:bg-white/80"
              }`}
            >
              <div className="line-clamp-2">{s.title}</div>
              <div className="mt-0.5 text-[10px] text-slate-400">
                {formatChatTime(s.updatedAt)}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="text-sm font-semibold text-slate-900">Assistant</div>
          <div className="mt-0.5 text-xs text-slate-500">
            GPT‑4o‑mini · streaming · sessions saved in this browser
          </div>
          {lastMeta && (
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-500">
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono">
                intent: {lastMeta.intent}
              </span>
              {lastMeta.sql_used && (
                <span className="line-clamp-2 max-w-full rounded-md bg-emerald-50 px-2 py-0.5 font-mono text-emerald-800">
                  {lastMeta.sql_used}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {msgs.length === 0 && !busy && (
            <div className="mx-auto max-w-lg rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-600">
              <p className="font-medium text-slate-800">Ask about your billing data</p>
              <p className="mt-2 text-xs text-slate-500">
                Examples: “How many anomalies are in the database?”, “List high severity alerts”, “What does
                the contract say about refunds?”
              </p>
            </div>
          )}

          {msgs.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[min(100%,42rem)] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-slate-900 text-white"
                    : "border border-slate-100 bg-slate-50 text-slate-800"
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
          ))}
          <div ref={bottomRef} />
        </div>

        {error && (
          <div className="border-t border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-800">
            {error}
          </div>
        )}

        <div className="border-t border-slate-100 p-3">
          <div className="flex gap-2">
            <textarea
              rows={1}
              className="max-h-32 min-h-[44px] flex-1 resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-blue-100 placeholder:text-slate-400 focus:ring-2"
              placeholder="Message…"
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
              className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? "…" : "Send"}
            </button>
          </div>
          <p className="mt-2 text-[10px] text-slate-400">
            Enter to send · Shift+Enter for newline
          </p>
        </div>
      </div>
    </div>
  );
}
