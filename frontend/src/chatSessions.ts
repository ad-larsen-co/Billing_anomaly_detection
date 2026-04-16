export type ChatRole = "user" | "assistant";

export type ChatMessage = { role: ChatRole; content: string };

export type ChatSession = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
};

const STORAGE_KEY = "billing-nlp-sessions-v1";

function safeParse(raw: string | null): ChatSession[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x): x is ChatSession =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as ChatSession).id === "string" &&
        Array.isArray((x as ChatSession).messages)
    );
  } catch {
    return [];
  }
}

export function loadSessions(): ChatSession[] {
  return safeParse(localStorage.getItem(STORAGE_KEY));
}

export function saveSessions(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    /* ignore quota */
  }
}

export function newSession(): ChatSession {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    title: "New chat",
    updatedAt: Date.now(),
    messages: [],
  };
}

export function sessionTitleFromMessages(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user" && m.content.trim());
  if (!first) return "New chat";
  const t = first.content.trim().replace(/\s+/g, " ");
  return t.length > 42 ? `${t.slice(0, 40)}…` : t;
}
