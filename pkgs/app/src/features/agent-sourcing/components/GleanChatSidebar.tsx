import { useState, useRef, useEffect, useCallback } from "react";
import {
  PanelLeftClose,
  PanelLeft,
  Plus,
  MessageSquare,
  Pencil,
  Trash2,
  Check,
  X,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { GleanChatListItem } from "../hooks/useGleanChats";

interface GleanChatSidebarProps {
  chats: GleanChatListItem[];
  activeChatId: string | null;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSelectChat: (id: string) => void;
  onCreateChat: () => void;
  onRenameChat: (id: string, title: string) => void;
  onDeleteChat: (id: string) => void;
}

export function GleanChatSidebar({
  chats,
  activeChatId,
  isCollapsed,
  onToggleCollapse,
  onSelectChat,
  onCreateChat,
  onRenameChat,
  onDeleteChat,
}: GleanChatSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    if (menuOpenId) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [menuOpenId]);

  const startRename = useCallback((chat: GleanChatListItem) => {
    setEditingId(chat._id);
    setEditTitle(chat.title);
    setMenuOpenId(null);
  }, []);

  const confirmRename = useCallback(() => {
    if (editingId && editTitle.trim()) {
      onRenameChat(editingId, editTitle.trim());
    }
    setEditingId(null);
    setEditTitle("");
  }, [editingId, editTitle, onRenameChat]);

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setEditTitle("");
  }, []);

  const handleDeleteChat = useCallback(
    (id: string) => {
      setMenuOpenId(null);
      onDeleteChat(id);
    },
    [onDeleteChat]
  );

  function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  if (isCollapsed) {
    return (
      <div className="flex flex-col items-center py-3 gap-2 w-12 border-r border-zinc-200 bg-zinc-50/80 shrink-0">
        <button
          onClick={onToggleCollapse}
          className="p-2 rounded-lg hover:bg-zinc-200 transition-colors text-zinc-500 hover:text-zinc-700"
          aria-label="Expand sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <button
          onClick={onCreateChat}
          className="p-2 rounded-lg hover:bg-zinc-200 transition-colors text-zinc-500 hover:text-zinc-700"
          aria-label="New chat"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-64 border-r border-zinc-200 bg-zinc-50/80 shrink-0 overflow-hidden">
      {/* Sidebar header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-zinc-200">
        <button
          onClick={onCreateChat}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New chat
        </button>
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg hover:bg-zinc-200 transition-colors text-zinc-500 hover:text-zinc-700"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto py-2">
        {chats.length === 0 ? (
          <p className="px-3 py-4 text-xs text-zinc-400 text-center">
            No conversations yet.
          </p>
        ) : (
          chats.map((chat) => {
            const isActive = chat._id === activeChatId;
            const isEditing = editingId === chat._id;
            const isMenuOpen = menuOpenId === chat._id;

            return (
              <div
                key={chat._id}
                className={cn(
                  "group relative flex items-center gap-2 mx-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors",
                  isActive
                    ? "bg-zinc-200/80 text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-800"
                )}
                onClick={() => {
                  if (!isEditing) onSelectChat(chat._id);
                }}
              >
                <MessageSquare className="h-4 w-4 shrink-0 opacity-60" />

                {isEditing ? (
                  <div className="flex-1 flex items-center gap-1 min-w-0">
                    <input
                      ref={editInputRef}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmRename();
                        if (e.key === "Escape") cancelRename();
                      }}
                      className="flex-1 text-sm bg-white border border-zinc-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-zinc-400 min-w-0"
                      maxLength={120}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        confirmRename();
                      }}
                      className="p-0.5 rounded hover:bg-zinc-300 text-green-600"
                      aria-label="Confirm rename"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelRename();
                      }}
                      className="p-0.5 rounded hover:bg-zinc-300 text-zinc-500"
                      aria-label="Cancel rename"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate font-medium">{chat.title}</p>
                      <p className="text-[11px] text-zinc-400 truncate">
                        {formatDate(chat.updatedAt || chat.createdAt)}
                      </p>
                    </div>

                    {/* Action menu trigger */}
                    <div className="relative" ref={isMenuOpen ? menuRef : undefined}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(isMenuOpen ? null : chat._id);
                        }}
                        className={cn(
                          "p-1 rounded hover:bg-zinc-300/60 transition-colors",
                          isMenuOpen
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100"
                        )}
                        aria-label="Chat options"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>

                      {isMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 z-50 w-36 rounded-lg border border-zinc-200 bg-white shadow-lg py-1 text-sm">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startRename(chat);
                            }}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-zinc-100 text-zinc-700"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Rename
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteChat(chat._id);
                            }}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-red-50 text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
