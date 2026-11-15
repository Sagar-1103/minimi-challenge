import type {
  ChatMessage,
  ConversationSummary,
  Citation,
  SystemHealth,
  ToolCallItem,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function fetchHealth(): Promise<SystemHealth> {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) {
    throw new Error(`Health check failed with status ${res.status}`);
  }
  return res.json();
}

export async function fetchConversations(): Promise<ConversationSummary[]> {
  const res = await fetch(`${API_BASE}/api/conversations?limit=50`);
  if (!res.ok) {
    throw new Error(`Failed to load conversations: ${res.statusText}`);
  }
  const data = await res.json();
  return data.conversations || [];
}

export async function fetchConversation(id: string): Promise<{
  id: string;
  title: string;
  messages: ChatMessage[];
}> {
  const res = await fetch(`${API_BASE}/api/conversations/${id}`);
  if (!res.ok) {
    throw new Error(`Failed to load conversation: ${res.statusText}`);
  }
  const data = await res.json();
  const conv = data.conversation;

  const messages: ChatMessage[] = (conv.messages || []).map((m: any) => ({
    id: m.id,
    role: m.role,
    content: m.content || "",
    timestamp: m.timestamp || m.createdAt,
    isStreaming: false,
    statusText: undefined,
    toolCalls: (m.toolCalls || []).map((t: any) => ({
      id: t.id,
      toolName: t.toolName,
      query: t.query,
      durationMs: t.duration,
      status: t.status,
    })),
  }));

  return {
    id: conv.id,
    title: conv.title,
    messages,
  };
}

export async function updateConversationTitle(
  id: string,
  title: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    throw new Error(`Failed to update conversation title`);
  }
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/conversations/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`Failed to delete conversation`);
  }
}

export interface StreamCallbacks {
  onStatus?: (message: string) => void;
  onToolStart?: (name: string, query: string, index: number) => void;
  onToolEnd?: (
    name: string,
    query: string,
    resultCount: number,
    durationMs: number
  ) => void;
  onAnswerStart?: () => void;
  onAnswerChunk?: (chunk: string) => void;
  onAnswerEnd?: (fullAnswer: string) => void;
  onSources?: (citations: Citation[]) => void;
  onDone?: (conversationId?: string, messageId?: string) => void;
  onError?: (message: string, code?: string) => void;
}

export async function streamChat(
  message: string,
  conversationId: string | undefined,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const userDate = new Date().toISOString();

  const res = await fetch(`${API_BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversationId, timezone, userDate }),
    signal,
  });

  if (!res.ok || !res.body) {
    let errorMsg = `Server responded with ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson.error?.message) errorMsg = errJson.error.message;
    } catch {
      // ignore
    }
    callbacks.onError?.(errorMsg);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const rawEvent of events) {
        if (!rawEvent.trim()) continue;

        let eventType = "message";
        let eventData = "";

        const lines = rawEvent.split("\n");
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            eventData = line.slice(6).trim();
          }
        }

        if (!eventData) continue;

        try {
          const parsed = JSON.parse(eventData);

          switch (eventType) {
            case "status":
              callbacks.onStatus?.(parsed.message);
              break;
            case "tool_start":
              callbacks.onToolStart?.(parsed.name, parsed.query, parsed.index);
              break;
            case "tool_end":
              callbacks.onToolEnd?.(
                parsed.name,
                parsed.query,
                parsed.resultCount,
                parsed.durationMs
              );
              break;
            case "answer_start":
              callbacks.onAnswerStart?.();
              break;
            case "answer_chunk":
              callbacks.onAnswerChunk?.(parsed.chunk);
              break;
            case "answer_end":
              callbacks.onAnswerEnd?.(parsed.fullAnswer);
              break;
            case "sources":
              callbacks.onSources?.(parsed.citations || []);
              break;
            case "done":
              callbacks.onDone?.(parsed.conversationId, parsed.messageId);
              break;
            case "error":
              callbacks.onError?.(parsed.message, parsed.code);
              break;
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } catch (err: any) {
    if (signal?.aborted) return;
    callbacks.onError?.(err?.message || "Stream interrupted");
  }
}
