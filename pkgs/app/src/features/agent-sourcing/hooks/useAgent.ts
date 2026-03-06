import { useCallback, useState } from "react";
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
}

export interface UseAgentReturn {
  messages: AgentMessage[];
  isThinking: boolean;
  sendMessage: (text: string) => void;
  confirmInventoryDraft?: (draft: InventoryDraftData) => void;
  cancelThinking?: () => void;
}

export function useAgent(options: UseAgentOptions): UseAgentReturn {
  const { role } = options;
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const streamCancelRef = { current: () => {} };

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
      setIsThinking(true);

      const timeoutId = window.setTimeout(() => {
        setIsThinking(false);
        const payload = simulateAgentResponse(trimmed, role);
        const introText =
          role === "farmer"
            ? "Here’s your draft. Confirm weight and price, then tap Post to list it."
            : "Here are some matches from our network. Add to order or start a conversation.";

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
            setMessages((prev) =>
              prev.map((m) =>
                m.id === introId ? { ...m, isStreaming: false } : m
              )
            );
            const cardMsg: AgentMessage = {
              ...payload,
              id: generateId(),
              role: "assistant",
              createdAt: new Date(),
            } as AgentMessage;
            setMessages((prev) => [...prev, cardMsg]);
          }
        );
      }, THINKING_DELAY_MS);

      return () => {
        window.clearTimeout(timeoutId);
        streamCancelRef.current();
      };
    },
    [role]
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
