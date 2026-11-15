"use client";

import { useState, useEffect } from "react";
import { PanelLeft, Plus, Calendar } from "lucide-react";

interface ChatHeaderProps {
  title?: string;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  sidebarOpen?: boolean;
}

export function ChatHeader({
  title,
  onToggleSidebar,
  onNewChat,
  sidebarOpen,
}: ChatHeaderProps) {
  const [currentDate, setCurrentDate] = useState<string>("");

  useEffect(() => {
    // Format in user's exact local locale and date
    const formatted = new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    setCurrentDate(formatted);
  }, []);

  const showTitle = Boolean(
    title &&
    title.toLowerCase() !== "new conversation" &&
    title.trim() !== ""
  );

  return (
    <header className="h-13 px-4 border-b border-white/[0.08] flex items-center justify-between shrink-0 bg-[#08090D]/80 backdrop-blur-md z-10">
      <div className="flex items-center gap-1.5 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="size-7 rounded-md text-white/50 hover:text-white hover:bg-white/[0.08] flex items-center justify-center transition-colors cursor-pointer"
          title="Toggle sidebar"
        >
          <PanelLeft className="size-4" />
        </button>
        {!sidebarOpen && (
          <button
            type="button"
            onClick={onNewChat}
            className="size-7 rounded-md text-white/50 hover:text-white hover:bg-white/[0.08] flex items-center justify-center transition-colors cursor-pointer"
            title="New chat (⌘N)"
          >
            <Plus className="size-4" />
          </button>
        )}
        {showTitle && (
          <h1 className="text-xs font-medium text-white/90 truncate max-w-md ml-1.5 animate-in fade-in duration-200">
            {title}
          </h1>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] text-white/60 bg-white/[0.05] border border-white/10 select-none">
          <Calendar className="size-3 text-blue-400" />
          <span>{currentDate || "Nov 16, 2026"}</span>
        </div>
      </div>
    </header>
  );
}
