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
} from "../types";

const THINKING_DELAY_MS = 1200;
const STREAM_CHUNK_MS = 35;

/** Backend Glean match response (real listings from MongoDB). */
interface GleanMatchResponse {
  query: string;
  items: ProductGridItem[];
  role: string;
}

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

type AgentResponsePayload =
  | Omit<ProductGridMessage, "id" | "role" | "createdAt">
  | Omit<InventoryFormMessage, "id" | "role" | "createdAt">;

/** Simulate parsing user text into draft (farmer) or query + mock matches (restaurant). */
function simulateAgentResponse(
  userText: string,
  role: UserRole
): AgentResponsePayload {
  const lower = userText.toLowerCase();

  if (role === "farmer") {
    // Extract numbers like "50kg", "50 kg", "50"
    const weightMatch = userText.match(/(\d+)\s*(kg|lb)?/i);
    const weight = weightMatch ? Number(weightMatch[1]) : 20;
    const unit = (weightMatch?.[2]?.toLowerCase() as "kg" | "lb") || "kg";
    const itemMatch = lower.match(/(carrots?|tomatoes?|potatoes?|onions?|lettuce|apples?|beets?|ugly|organic)/);
    const item = itemMatch ? (itemMatch[1] === "ugly" ? "carrots" : itemMatch[1]) : "produce";
    const title = `Fresh ${item} — ${weight}${unit}`;
    const draft: InventoryDraftData = {
      title,
      item: item.replace(/s$/, ""), // singular
      description: userText.slice(0, 200),
      weightKg: unit === "lb" ? weight * 0.453592 : weight,
      pricePerKg: 2.5,
      unit: unit === "lb" ? "lb" : "kg",
    };
    return {
      type: "inventory_form",
      draft,
      userMessage: userText,
    };
  }

  // Restaurant: mock product grid from "need X by Friday" style
  const qtyMatch = userText.match(/(\d+)\s*(kg|lb)?/i);
  const qty = qtyMatch ? Number(qtyMatch[1]) : 20;
  const unit = (qtyMatch?.[2]?.toLowerCase() as "kg" | "lb") || "kg";
  const itemMatch = lower.match(/(carrots?|tomatoes?|potatoes?|onions?|lettuce|apples?|beets?)/);
  const item = itemMatch ? itemMatch[1] : "carrots";
  const items: ProductGridItem[] = [
    {
      id: "1",
      listingId: "listing-1",
      title: `Fresh ${item} — local farm`,
      item,
      description: "Harvested this week, great for soups and roasting.",
      price: 2.8,
      qty,
      unit: unit as "kg" | "lb",
      farmerName: "Green Valley Farm",
      farmerId: "farmer-1",
    },
    {
      id: "2",
      listingId: "listing-2",
      title: `Organic ${item}`,
      item,
      description: "Ugly but delicious, perfect for juice or stew.",
      price: 2.2,
      qty,
      unit: unit as "kg" | "lb",
      farmerName: "Sunrise Organics",
      farmerId: "farmer-2",
    },
    {
      id: "3",
      listingId: "listing-3",
      title: `Bulk ${item} — restaurant grade`,
      item,
      price: 2.5,
      qty,
      unit: unit as "kg" | "lb",
      farmerName: "Hilltop Produce",
      farmerId: "farmer-3",
    },
  ];
  return {
    type: "product_grid",
    query: userText,
    items,
  };
}

/** Build intro text and optional payload; for restaurant, payload may come from API. */
function getIntroAndPayload(
  role: UserRole,
  trimmed: string,
  apiItems?: ProductGridItem[] | null
): { introText: string; payload: AgentResponsePayload } {
  if (role === "farmer") {
    const payload = simulateAgentResponse(trimmed, role);
    return {
      introText:
        "Here's your draft. Confirm weight and price, then tap Post to list it.",
      payload,
    };
  }
  if (apiItems != null && apiItems.length > 0) {
    return {
      introText:
        "Here are some matches from our network. Add to order or start a conversation.",
      payload: { type: "product_grid", query: trimmed, items: apiItems },
    };
  }
  const payload = simulateAgentResponse(trimmed, role) as Omit<
    ProductGridMessage,
    "id" | "role" | "createdAt"
  >;
  return {
    introText:
      "Here are some matches from our network. Add to order or start a conversation.",
    payload,
  };
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

export interface UseAgentReturn {
  messages: AgentMessage[];
  isThinking: boolean;
  sendMessage: (text: string) => void;
  confirmInventoryDraft?: (draft: InventoryDraftData) => void;
  cancelThinking?: () => void;
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
              type: m.type as "text" | "product_grid" | "inventory_form",
              createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
            };
            if (base.type === "text") {
              return {
                ...base,
                content: String(m.content ?? ""),
                isStreaming: false,
              } as TextMessage;
            }
            if (base.type === "product_grid") {
              return {
                ...base,
                query: "",
                items: Array.isArray(m.items) ? (m.items as ProductGridItem[]) : [],
              } as AgentMessage;
            }
            return {
              ...base,
              draft: m.draft as InventoryDraftData,
            } as AgentMessage;
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
    async (payload: {
      role: "user" | "assistant";
      type: "text" | "product_grid" | "inventory_form";
      content?: string;
      items?: ProductGridItem[];
      draft?: InventoryDraftData;
    }) => {
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
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const userMsg: TextMessage = {
        id: generateId(),
        role: "user",
        type: "text",
        content: trimmed,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      void persistMessage({ role: "user", type: "text", content: trimmed });
      setIsThinking(true);

      let cancelled = false;
      const cleanup = () => {
        cancelled = true;
        streamCancelRef.current();
      };

      const showResponse = (apiItems: ProductGridItem[] | null) => {
        if (cancelled) return;
        setIsThinking(false);
        const { introText, payload } = getIntroAndPayload(role, trimmed, apiItems);
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
                items: (cardMsg as any).items as ProductGridItem[],
              });
            } else if (cardMsg.type === "inventory_form") {
              void persistMessage({
                role: "assistant",
                type: "inventory_form",
                draft: (cardMsg as any).draft as InventoryDraftData,
              });
            }
          }
        );
      };

      if (role === "restaurant") {
        fetch(`${CFG.API_URL}/api/glean/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: trimmed, role: "restaurant" }),
        })
          .then((res) =>
            res.ok ? res.json() : Promise.reject(new Error(res.statusText))
          )
          .then((data: GleanMatchResponse) => {
            const items = (data.items ?? []).map((it) => ({
              ...it,
              imageUrl: it.imageId
                ? `${CFG.API_URL}/api/images/${it.imageId}`
                : it.imageUrl,
            }));
            showResponse(items.length ? items : null);
          })
          .catch(() => {
            showResponse(null);
          });
        return cleanup;
      }

      const timeoutId = window.setTimeout(() => {
        showResponse(null);
      }, THINKING_DELAY_MS);

      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
        streamCancelRef.current();
      };
    },
    [persistMessage, role]
  );

  const cancelThinking = useCallback(() => {
    setIsThinking(false);
    streamCancelRef.current();
  }, []);

  return {
    messages,
    isThinking,
    sendMessage,
    cancelThinking,
  };
}
