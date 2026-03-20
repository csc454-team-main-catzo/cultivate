import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import CFG from "@/config";
import type { UserRole } from "../types";

export interface GleanChatListItem {
  _id: string;
  title: string;
  role: "farmer" | "restaurant";
  createdAt: string;
  updatedAt: string;
}

export interface UseGleanChatsReturn {
  chats: GleanChatListItem[];
  activeChatId: string | null;
  isLoading: boolean;
  error: string | null;
  setActiveChatId: (id: string | null) => void;
  createChat: (title?: string) => Promise<string | null>;
  renameChat: (id: string, title: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  refreshChats: () => Promise<void>;
}

export function useGleanChats(role: UserRole): UseGleanChatsReturn {
  const { isAuthenticated, getAccessTokenSilently } = useAuth0();
  const [chats, setChats] = useState<GleanChatListItem[]>([]);
  const storageKey = `glean:activeChatId:${role}`;
  const [activeChatId, _setActiveChatId] = useState<string | null>(() => {
    try { return sessionStorage.getItem(storageKey) ?? null; } catch { return null; }
  });
  const setActiveChatId = useCallback((id: string | null) => {
    _setActiveChatId(id);
    try {
      if (id) sessionStorage.setItem(storageKey, id);
      else sessionStorage.removeItem(storageKey);
    } catch { /* ignore */ }
  }, [storageKey]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialLoadDone = useRef(false);

  const getAuthHeaders = useCallback(async () => {
    if (!isAuthenticated) return null;
    const token = await getAccessTokenSilently({
      authorizationParams: { audience: CFG.AUTH0_AUDIENCE },
    });
    return { Authorization: `Bearer ${token}` };
  }, [getAccessTokenSilently, isAuthenticated]);

  const fetchChats = useCallback(async (): Promise<GleanChatListItem[]> => {
    const headers = await getAuthHeaders();
    if (!headers) return [];
    const res = await fetch(`${CFG.API_URL}/api/glean/chats`, { headers });
    if (!res.ok) throw new Error(`Failed to load chats (${res.status})`);
    const data = (await res.json()) as GleanChatListItem[];
    return Array.isArray(data) ? data : [];
  }, [getAuthHeaders]);

  const refreshChats = useCallback(async () => {
    try {
      const list = await fetchChats();
      setChats(list);
    } catch (err) {
      console.error("Failed to refresh Glean chats:", err);
    }
  }, [fetchChats]);

  useEffect(() => {
    let isCancelled = false;

    async function loadInitial() {
      if (!isAuthenticated) {
        setChats([]);
        setActiveChatId(null);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        const headers = await getAuthHeaders();
        if (!headers || isCancelled) return;

        const desiredRole = role === "restaurant" ? "restaurant" : "farmer";
        const res = await fetch(`${CFG.API_URL}/api/glean/chats/ensure`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ role: desiredRole }),
        });
        if (!res.ok) throw new Error(`Failed to ensure chat (${res.status})`);
        const ensured = (await res.json()) as GleanChatListItem;

        const list = await fetchChats();
        if (isCancelled) return;

        const roleChats = list.filter((c) => c.role === desiredRole);
        setChats(roleChats);

        if (!initialLoadDone.current) {
          const restored = sessionStorage.getItem(storageKey);
          const validRestored = restored && roleChats.some((c) => c._id === restored);
          setActiveChatId(validRestored ? restored : ensured._id);
          initialLoadDone.current = true;
        }
      } catch (err) {
        if (!isCancelled) {
          const msg = err instanceof Error ? err.message : "Failed to load chats.";
          setError(msg);
        }
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    void loadInitial();
    return () => {
      isCancelled = true;
    };
  }, [getAuthHeaders, isAuthenticated, role, fetchChats]);

  const createChat = useCallback(
    async (title?: string): Promise<string | null> => {
      try {
        const headers = await getAuthHeaders();
        if (!headers) return null;

        const desiredRole = role === "restaurant" ? "restaurant" : "farmer";
        const res = await fetch(`${CFG.API_URL}/api/glean/chats`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ role: desiredRole, title: title || "New chat" }),
        });
        if (!res.ok) throw new Error(`Failed to create chat (${res.status})`);
        const created = (await res.json()) as GleanChatListItem;

        setChats((prev) => [created, ...prev]);
        setActiveChatId(created._id);
        return created._id;
      } catch (err) {
        console.error("Failed to create Glean chat:", err);
        return null;
      }
    },
    [getAuthHeaders, role]
  );

  const renameChat = useCallback(
    async (id: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      try {
        const headers = await getAuthHeaders();
        if (!headers) return;

        const res = await fetch(`${CFG.API_URL}/api/glean/chats/${id}`, {
          method: "PATCH",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed }),
        });
        if (!res.ok) throw new Error(`Failed to rename chat (${res.status})`);

        setChats((prev) =>
          prev.map((c) => (c._id === id ? { ...c, title: trimmed } : c))
        );
      } catch (err) {
        console.error("Failed to rename Glean chat:", err);
      }
    },
    [getAuthHeaders]
  );

  const deleteChat = useCallback(
    async (id: string) => {
      try {
        const headers = await getAuthHeaders();
        if (!headers) return;

        const res = await fetch(`${CFG.API_URL}/api/glean/chats/${id}`, {
          method: "DELETE",
          headers,
        });
        if (!res.ok) throw new Error(`Failed to delete chat (${res.status})`);

        setChats((prev) => {
          const remaining = prev.filter((c) => c._id !== id);
          if (activeChatId === id) {
            setActiveChatId(remaining.length > 0 ? remaining[0]._id : null);
          }
          return remaining;
        });
      } catch (err) {
        console.error("Failed to delete Glean chat:", err);
      }
    },
    [getAuthHeaders, activeChatId]
  );

  return {
    chats,
    activeChatId,
    isLoading,
    error,
    setActiveChatId,
    createChat,
    renameChat,
    deleteChat,
    refreshChats,
  };
}
