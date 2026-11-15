"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { ArrowDown } from "lucide-react";
import { MessageBubble } from "./message-bubble";
import { ChatInput } from "./chat-input";
import type { ChatMessage } from "../lib/types";

interface ChatAreaProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendMessage: (message: string) => void;
  onStop: () => void;
}

export function ChatArea({
  messages,
  isStreaming,
  onSendMessage,
  onStop,
}: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current || messages.length === 0) {
      setShowScrollBottom(false);
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // Don't show if content doesn't even exceed container height
    if (scrollHeight <= clientHeight + 40) {
      setShowScrollBottom(false);
      return;
    }
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    setShowScrollBottom(distanceFromBottom > 100);
  }, [messages.length]);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  useEffect(() => {
    if (messages.length === 0) {
      setShowScrollBottom(false);
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
      return;
    }
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  return (
    <div className="flex-1 h-full bg-[#08090D] cosmic-glow overflow-hidden relative">
      {/* Background celestial wavy radial lines (subtle ambient light) */}
      <div className="absolute inset-0 pointer-events-none opacity-40">
        <svg
          className="w-full h-full"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
          viewBox="0 0 1200 800"
        >
          <path
            d="M -100 400 C 300 200, 600 600, 1300 350"
            fill="none"
            stroke="rgba(255,255,255,0.03)"
            strokeWidth="1.5"
          />
          <path
            d="M -100 450 C 400 150, 700 650, 1300 400"
            fill="none"
            stroke="rgba(255,255,255,0.02)"
            strokeWidth="1.5"
          />
          <path
            d="M -100 500 C 500 100, 800 700, 1300 450"
            fill="none"
            stroke="rgba(255,255,255,0.015)"
            strokeWidth="1.5"
          />
        </svg>
      </div>

      {/* Full-height scrollable viewport: scrollbar spans all the way to the screen bottom */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto w-full relative z-10"
      >
        <div className="max-w-3xl w-full mx-auto px-4 md:px-8 pt-6 pb-44 min-h-full flex flex-col">
          {messages.length === 0 ? (
            // Empty State
            <div className="flex-1 flex flex-col items-center justify-center text-center px-4 max-w-lg mx-auto py-12">
              <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight mb-2.5">
                Search beneath the surface.
              </h2>

              <p className="text-sm sm:text-base text-white/50 leading-relaxed max-w-md">
                Clear answers backed by live sources.
              </p>
            </div>
          ) : (
            <div className="space-y-4 flex-1">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ChatGPT-style Floating Scroll-to-Bottom Button */}
      {showScrollBottom && messages.length > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 size-8 rounded-full bg-[#161B26]/90 hover:bg-[#1E2536] border border-white/15 text-white/70 hover:text-white flex items-center justify-center shadow-xl backdrop-blur-md transition-all active:scale-95 cursor-pointer"
          title="Scroll to bottom"
        >
          <ArrowDown className="size-4" />
        </button>
      )}

      {/* Floating Bottom Input with subtle gradient mask (stops before right scrollbar gutter) */}
      <div className="absolute bottom-0 left-0 right-3.5 z-20 pointer-events-none bg-gradient-to-t from-[#08090D] via-[#08090D]/85 to-transparent pt-8 pb-3">
        <div className="pointer-events-auto">
          <ChatInput
            onSendMessage={onSendMessage}
            onStop={onStop}
            isStreaming={isStreaming}
          />
        </div>
      </div>
    </div>
  );
}
