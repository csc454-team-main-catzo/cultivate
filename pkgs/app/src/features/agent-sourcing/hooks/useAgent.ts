/**
 * Glean chat: send user message → backend agent API → stream intro + structured payload (product grid or draft form).
 * Pattern inspired by the 21st.dev Chat App template: https://21st.dev/agents/docs/templates/chat-app
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import CFG from "@/config";
import type {
  AgentMessage,
  InventoryDraftData,
  InventoryFormMessage,
  ProductGridMessage,
  ProductGridItem,
  TextMessage,
  UserRole,
  StrategyOptionsMessage,
  StrategyOptionItem,
  SourcingPlanData,
} from "../types";

const STREAM_CHUNK_MS = 35;

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

type AgentResponsePayload =
  | Omit<ProductGridMessage, "id" | "role" | "createdAt">
  | Omit<InventoryFormMessage, "id" | "role" | "createdAt">;

/** Backend Glean Agent API response. */
interface GleanAgentResponse {
  introText: string;
  payload: {
    type: "product_grid";
    query: string;
    items: Array<ProductGridItem & { imageId?: string }>;
  } | {
    type: "inventory_form";
    draft: InventoryDraftData;
    userMessage?: string;
  } | null;
}

/** Fallback when agent API fails: simple regex-based draft or empty product grid. */
function fallbackAgentResponse(userText: string, role: UserRole): AgentResponsePayload {
  const lower = userText.toLowerCase();
  if (role === "farmer") {
    const weightMatch = userText.match(/(\d+)\s*(kg|lb)?/i);
    const weight = weightMatch ? Number(weightMatch[1]) : 20;
    const unit = (weightMatch?.[2]?.toLowerCase() as "kg" | "lb") || "kg";
    const itemMatch = lower.match(/(carrots?|tomatoes?|potatoes?|onions?|lettuce|apples?|beets?|ugly|organic)/);
    const item = itemMatch ? (itemMatch[1] === "ugly" ? "carrots" : itemMatch[1]) : "produce";
    const title = `Fresh ${item} — ${weight}${unit}`;
    return {
      type: "inventory_form",
      draft: {
        title,
        item: item.replace(/s$/, ""),
        description: userText.slice(0, 200),
        weightKg: unit === "lb" ? weight * 0.453592 : weight,
        pricePerKg: 3.5,
        unit: unit === "lb" ? "lb" : "kg",
      },
      userMessage: userText,
    };
  }
  return { type: "product_grid", query: userText, items: [] };
}

/** Map API payload to frontend payload; resolve imageId -> imageUrl. */
function toPayload(res: GleanAgentResponse["payload"]): AgentResponsePayload | null {
  if (!res) return null;
  if (res.type === "product_grid") {
    const items: ProductGridItem[] = (res.items ?? []).map((it) => ({
      ...it,
      imageUrl: it.imageId ? `${CFG.API_URL}/api/images/${it.imageId}` : it.imageUrl,
    }));
    return { type: "product_grid", query: res.query, items };
  }
  return { type: "inventory_form", draft: res.draft, userMessage: res.userMessage };
}

/** Simulated streaming: append characters one by one. */
function streamText(
  fullText: string,
  onChunk: (soFar: string) => void,
  onDone: () => void
): () => void {
  let i = 0;
  let cancelled = false;
  const tick = () => {
    if (cancelled || i >= fullText.length) {
      onDone();
      return;
    }
    i += 1;
    onChunk(fullText.slice(0, i));
    setTimeout(tick, STREAM_CHUNK_MS);
  };
  setTimeout(tick, 0);
  return () => {
    cancelled = true;
  };
}

export interface UseAgentOptions {
  role: UserRole;
  chatId: string | null;
}

export type PersistMessagePayload = {
  role: "user" | "assistant";
  type: "text" | "product_grid" | "inventory_form" | "strategy_options";
  content?: string;
  items?: ProductGridItem[];
  draft?: InventoryDraftData;
  options?: StrategyOptionItem[];
  recommendedStrategyId?: string | null;
  sourcingPlan?: SourcingPlanData;
};

export interface UseAgentReturn {
  messages: AgentMessage[];
  isThinking: boolean;
  sendMessage: (text: string, options?: { imageId?: string }) => void;
  confirmInventoryDraft?: (draft: InventoryDraftData) => void;
  cancelThinking?: () => void;
  pushMessages: (...msgs: AgentMessage[]) => void;
  setThinking: (v: boolean) => void;
  persistMessage: (payload: PersistMessagePayload) => Promise<void>;
}

export function useAgent(options: UseAgentOptions): UseAgentReturn {
  const { role, chatId } = options;
  const { isAuthenticated, getAccessTokenSilently } = useAuth0();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const streamCancelRef = { current: () => {} };

  const getAuthHeaders = useCallback(async () => {
    if (!isAuthenticated) return null;
    const token = await getAccessTokenSilently({
      authorizationParams: { audience: CFG.AUTH0_AUDIENCE },
    });
    return { Authorization: `Bearer ${token}` };
  }, [getAccessTokenSilently, isAuthenticated]);

  // Load persisted messages when switching chats.
  useEffect(() => {
    let isCancelled = false;

    async function loadChat() {
      if (!chatId || !isAuthenticated) {
        setMessages([]);
        return;
      }
      try {
        const headers = await getAuthHeaders();
        if (!headers) return;
        const res = await fetch(`${CFG.API_URL}/api/glean/chats/${chatId}`, {
          headers,
        });
        if (!res.ok) throw new Error(`Failed to load chat (${res.status})`);
        const data = (await res.json()) as any;
        const serverMessages = Array.isArray(data?.messages) ? data.messages : [];
        const mapped = serverMessages
          .map((m: any): AgentMessage | null => {
            const base = {
              id: String(m._id ?? generateId()),
              role: m.role as "user" | "assistant",
              createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
            };
            if (m.type === "text") {
              return {
                ...base,
                type: "text",
                content: String(m.content ?? ""),
                isStreaming: false,
              } as TextMessage;
            }
            if (m.type === "product_grid") {
              return {
                ...base,
                type: "product_grid",
                query: "",
                items: Array.isArray(m.items) ? (m.items as ProductGridItem[]) : [],
              } as ProductGridMessage;
            }
            if (m.type === "strategy_options") {
              return {
                ...base,
                type: "strategy_options",
                options: Array.isArray(m.options) ? m.options : [],
                recommendedStrategyId: m.recommendedStrategyId ?? null,
                sourcingPlan: m.sourcingPlan ?? {
                  orderId: "",
                  strategies: [],
                  unfulfillable: [],
                  summary: "",
                  reasoning: "",
                },
              } as StrategyOptionsMessage;
            }
            if (m.type === "inventory_form") {
              return {
                ...base,
                type: "inventory_form",
                draft: m.draft as InventoryDraftData,
              } as InventoryFormMessage;
            }
            return null;
          })
          .filter(Boolean) as AgentMessage[];
        if (!isCancelled) setMessages(mapped);
      } catch (err) {
        console.error("Failed to load Glean chat messages:", err);
      }
    }

    void loadChat();
    return () => {
      isCancelled = true;
    };
  }, [chatId, getAuthHeaders, isAuthenticated]);

  const persistMessage = useCallback(
    async (payload: PersistMessagePayload) => {
      if (!chatId || !isAuthenticated) return;
      try {
        const headers = await getAuthHeaders();
        if (!headers) return;
        await fetch(`${CFG.API_URL}/api/glean/chats/${chatId}/messages`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        console.error("Failed to persist Glean message:", err);
      }
    },
    [chatId, getAuthHeaders, isAuthenticated]
  );

  const sendMessage = useCallback(
    (text: string, options?: { imageId?: string }) => {
      const trimmed = text.trim();
      if (!trimmed && !options?.imageId) return;
      const promptForApi = trimmed || (options?.imageId ? "Create listing from this photo" : "");
      const displayContent = trimmed || (options?.imageId ? "Create listing from this photo" : "");

      const userMsg: TextMessage = {
        id: generateId(),
        role: "user",
        type: "text",
        content: displayContent,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      void persistMessage({ role: "user", type: "text", content: displayContent });
      setIsThinking(true);

      let cancelled = false;
      const cleanup = () => {
        cancelled = true;
        streamCancelRef.current();
      };

      const defaultIntro =
        role === "farmer"
          ? "Here's your draft. Confirm weight and price, then tap Post to list it."
          : "Here are matching listings from our network. Take a look.";

      const showResponse = (introText: string, payload: AgentResponsePayload | null) => {
        if (cancelled) return;
        setIsThinking(false);
        const introId = generateId();
        setMessages((prev) => [
          ...prev,
          {
            id: introId,
            role: "assistant",
            type: "text",
            content: "",
            createdAt: new Date(),
            isStreaming: true,
          } as TextMessage,
        ]);
        streamCancelRef.current = streamText(
          introText,
          (soFar) => {
            if (cancelled) return;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === introId
                  ? {
                      ...m,
                      content: soFar,
                      isStreaming: soFar.length < introText.length,
                    }
                  : m
              )
            );
          },
          () => {
            if (cancelled) return;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === introId ? { ...m, isStreaming: false } : m
              )
            );
            void persistMessage({
              role: "assistant",
              type: "text",
              content: introText,
            });
            if (payload) {
              const cardMsg: AgentMessage = {
                ...payload,
                id: generateId(),
                role: "assistant",
                createdAt: new Date(),
              } as AgentMessage;
              setMessages((prev) => [...prev, cardMsg]);
              if (cardMsg.type === "product_grid") {
                void persistMessage({
                  role: "assistant",
                  type: "product_grid",
                  items: (cardMsg as ProductGridMessage).items,
                });
              } else if (cardMsg.type === "inventory_form") {
                void persistMessage({
                  role: "assistant",
                  type: "inventory_form",
                  draft: (cardMsg as InventoryFormMessage).draft,
                });
              }
            }
          }
        );
      };

      const priorMessages = messages.slice(-10).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.type === "text" ? (m as TextMessage).content : undefined,
        type: m.type,
      }));

      const body: { prompt: string; role: string; priorMessages: unknown[]; imageId?: string } = {
        prompt: promptForApi,
        role,
        priorMessages,
      };
      if (options?.imageId) body.imageId = options.imageId;

      getAuthHeaders()
        .then((headers) =>
          fetch(`${CFG.API_URL}/api/glean/agent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(headers ?? {}) },
            body: JSON.stringify(body),
          })
        )
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
        .then((data: GleanAgentResponse) => {
          const payload = toPayload(data.payload);
          const intro = (data.introText && data.introText.trim()) || (payload ? defaultIntro : "") || defaultIntro;
          showResponse(intro, payload);
        })
        .catch(() => {
          showResponse(defaultIntro, fallbackAgentResponse(trimmed, role));
        });

      return cleanup;
    },
    [messages, persistMessage, role, getAuthHeaders]
  );

  const cancelThinking = useCallback(() => {
    setIsThinking(false);
    streamCancelRef.current();
  }, []);

  const pushMessages = useCallback((...msgs: AgentMessage[]) => {
    setMessages((prev) => [...prev, ...msgs]);
  }, []);

  const setThinking = useCallback((v: boolean) => {
    setIsThinking(v);
  }, []);

  return {
    messages,
    isThinking,
    sendMessage,
    cancelThinking,
    pushMessages,
    setThinking,
    persistMessage,
  };
}
