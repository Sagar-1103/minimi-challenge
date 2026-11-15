"use client";

import { useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ConversationSummary } from "../lib/types";
import { deleteConversation } from "../lib/api";

interface SidebarProps {
  conversations: ConversationSummary[];
  activeId?: string;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onConversationDeleted: (id: string) => void;
  isOpen: boolean;
}

export function Sidebar({
  conversations,
  activeId,
  onSelectConversation,
  onNewChat,
  onConversationDeleted,
  isOpen,
}: SidebarProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "n")) {
        e.preventDefault();
        onNewChat();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNewChat]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteConversation(id);
      onConversationDeleted(id);
    } catch (err) {
      console.error("Failed to delete conversation", err);
    }
  };

  return (
    <aside
      aria-hidden={!isOpen}
      className={`h-screen flex flex-col bg-[#06070A] shrink-0 select-none z-20 overflow-hidden transition-[width,opacity] duration-300 ease-in-out ${
        isOpen
          ? "w-64 border-r border-white/[0.08] opacity-100"
          : "w-0 border-r-0 opacity-0 pointer-events-none"
      }`}
    >
      {/* Inner fixed-width wrapper to prevent reflow while sliding */}
      <div className="w-64 h-full flex flex-col">
        {/* Brand & New Chat Header Row (Clean, Modern, No Clunky Pills) */}
        <div className="p-3 border-b border-white/[0.08]">
          <div className="flex items-center justify-between px-1.5 py-1">
            <span className="font-semibold text-sm tracking-wide text-white">
              Mimi
            </span>
            <button
              type="button"
              onClick={onNewChat}
              className="size-7 rounded-lg text-white/50 hover:text-white hover:bg-white/[0.08] flex items-center justify-center transition-colors cursor-pointer"
              title="New chat (⌘N)"
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>

        {/* Recent Chats List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-medium text-white/40">
            Recent chats
          </div>

          {conversations.length === 0 ? (
            <div className="px-3 py-8 text-xs text-white/40 text-center">
              No past chats
            </div>
          ) : (
            conversations.map((c) => {
              const isActive = c.id === activeId;
              return (
                <div
                  key={c.id}
                  onClick={() => onSelectConversation(c.id)}
                  className={`group flex items-center justify-between w-full px-2.5 py-2 rounded-lg text-xs transition-colors cursor-pointer select-none text-left ${
                    isActive
                      ? "bg-white/[0.12] text-white font-medium"
                      : "text-white/60 hover:text-white hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="min-w-0 flex-1 mr-1">
                    <span className="truncate block">{c.title}</span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, c.id)}
                    className="opacity-0 group-hover:opacity-100 size-5 flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded transition-all cursor-pointer shrink-0"
                    title="Delete chat"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
