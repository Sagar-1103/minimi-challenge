"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Sidebar } from "../components/sidebar";
import { ChatHeader } from "../components/chat-header";
import { ChatArea } from "../components/chat-area";
import type { ChatMessage, ConversationSummary } from "../lib/types";
import {
  fetchConversations,
  fetchConversation,
  streamChat,
} from "../lib/api";

export default function Home() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [activeTitle, setActiveTitle] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const abortControllerRef = useRef<AbortController | null>(null);

  const loadConversationsList = useCallback(async () => {
    try {
      const list = await fetchConversations();
      setConversations(list);
    } catch (err) {
      console.error("Failed to fetch conversations", err);
    }
  }, []);

  useEffect(() => {
    loadConversationsList();
  }, [loadConversationsList]);

  const handleSelectConversation = async (id: string) => {
    if (isStreaming) {
      abortControllerRef.current?.abort();
      setIsStreaming(false);
    }
    setActiveId(id);
    try {
      const data = await fetchConversation(id);
      setActiveTitle(data.title);
      setMessages(data.messages);
    } catch (err) {
      console.error("Failed to load conversation", err);
    }
  };

  const handleNewChat = () => {
    if (isStreaming) {
      abortControllerRef.current?.abort();
      setIsStreaming(false);
    }
    setActiveId(undefined);
    setActiveTitle("");
    setMessages([]);
  };

  const handleConversationDeleted = (deletedId: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== deletedId));
    if (activeId === deletedId) {
      handleNewChat();
    }
  };

  const handleSendMessage = async (text: string) => {
    if (isStreaming) return;

    const userMessageId = `user-${Date.now()}`;
    const assistantMessageId = `assistant-${Date.now()}`;

    const userMsg: ChatMessage = {
      id: userMessageId,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };

    const initialAssistantMsg: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      isStreaming: true,
      statusText: "Thinking...",
      toolCalls: [],
      citations: [],
    };

    setMessages((prev) => [...prev, userMsg, initialAssistantMsg]);
    setIsStreaming(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await streamChat(
        text,
        activeId,
        {
          onStatus: (statusMessage) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId
                  ? { ...m, statusText: statusMessage }
                  : m
              )
            );
          },
          onToolStart: (name, query, index) => {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMessageId) return m;
                const existing = m.toolCalls || [];
                return {
                  ...m,
                  statusText: `Searching: "${query}"`,
                  toolCalls: [
                    ...existing,
                    {
                      toolName: name,
                      query,
                      status: "running",
                    },
                  ],
                };
              })
            );
          },
          onToolEnd: (name, query, resultCount, durationMs) => {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantMessageId) return m;
                const updatedTools = (m.toolCalls || []).map((t) =>
                  t.query === query
                    ? {
                        ...t,
                        resultCount,
                        durationMs,
                        status: "SUCCESS" as const,
                      }
                    : t
                );
                return {
                  ...m,
                  toolCalls: updatedTools,
                };
              })
            );
          },
          onAnswerStart: () => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId
                  ? { ...m, statusText: "" }
                  : m
              )
            );
          },
          onAnswerChunk: (chunk) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId
                  ? { ...m, content: m.content + chunk }
                  : m
              )
            );
          },
          onAnswerEnd: (fullAnswer) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId
                  ? { ...m, content: fullAnswer }
                  : m
              )
            );
          },
          onSources: (citations) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId
                  ? { ...m, citations }
                  : m
              )
            );
          },
          onDone: (newConvId) => {
            setIsStreaming(false);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId
                  ? { ...m, isStreaming: false, statusText: undefined }
                  : m
              )
            );
            if (newConvId && newConvId !== activeId) {
              setActiveId(newConvId);
            }
            loadConversationsList();
          },
          onError: (errorMessage) => {
            setIsStreaming(false);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId
                  ? {
                      ...m,
                      isStreaming: false,
                      statusText: undefined,
                      content:
                        m.content ||
                        `⚠️ Unable to complete request: ${errorMessage}`,
                    }
                  : m
              )
            );
          },
        },
        abortController.signal
      );
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Stream error:", err);
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? { ...m, isStreaming: false, statusText: undefined }
            : m
        )
      );
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((m) =>
        m.isStreaming
          ? { ...m, isStreaming: false, statusText: undefined }
          : m
      )
    );
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#08090D] font-sans antialiased text-[#EDEDED]">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        onConversationDeleted={handleConversationDeleted}
        isOpen={sidebarOpen}
      />

      <div className="flex flex-col flex-1 h-full min-w-0">
        <ChatHeader
          title={activeTitle}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onNewChat={handleNewChat}
          sidebarOpen={sidebarOpen}
        />
        <ChatArea
          messages={messages}
          isStreaming={isStreaming}
          onSendMessage={handleSendMessage}
          onStop={handleStop}
        />
      </div>
    </div>
  );
}
