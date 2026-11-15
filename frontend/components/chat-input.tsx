"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { ArrowUp, Square } from "lucide-react";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
}

export function ChatInput({
  onSendMessage,
  onStop,
  isStreaming = false,
  disabled = false,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        200
      )}px`;
    }
  }, [input]);

  const handleSubmit = () => {
    if (isStreaming) {
      onStop?.();
      return;
    }

    const trimmed = input.trim();
    if (!trimmed || disabled) return;

    onSendMessage(trimmed);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const hasContent = Boolean(input.trim()) && !disabled;

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pb-6 pt-1">
      {/* Sleek Frosted Glass Input Card */}
      <div className="relative rounded-2xl border border-white/[0.12] bg-[#12151C]/90 backdrop-blur-xl shadow-2xl focus-within:border-white/30 focus-within:ring-1 focus-within:ring-white/20 transition-all">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything..."
          rows={1}
          disabled={disabled && !isStreaming}
          className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[14px] text-white placeholder:text-white/40 focus:outline-none min-h-[48px] max-h-[180px]"
        />

        {/* Minimal Bottom Toolbar */}
        <div className="flex items-center justify-end px-3.5 pb-3 pt-0.5">
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              className="size-7 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 flex items-center justify-center transition-all active:scale-95 cursor-pointer"
              title="Stop generation"
            >
              <Square className="size-3 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!hasContent}
              onClick={handleSubmit}
              className={`size-7 rounded-lg border flex items-center justify-center transition-all duration-150 active:scale-95 cursor-pointer ${
                hasContent
                  ? "bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white border-blue-500/60 shadow-sm shadow-blue-600/30"
                  : "bg-white/10 text-white/30 border-white/10 opacity-30 pointer-events-none"
              }`}
              title="Send message (Enter)"
            >
              <ArrowUp className="size-3.5 stroke-[2.5]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
