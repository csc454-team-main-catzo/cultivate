import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Tractor, ChefHat, Bot, User, DollarSign, Zap, Award, LayoutGrid, Star, CheckCircle2, AlertTriangle, ChevronRight, Info, PackageCheck } from "lucide-react";
import { useAgent } from "../hooks/useAgent";
import { getAgentTheme } from "../lib/theme";
import type {
  AgentMessage,
  InventoryDraftData,
  UserRole,
  StrategyOptionsMessage,
  StrategyOptionItem,
  StrategyAllocation,
  SourcingPlanData,
  ProductGridItem,
  TextMessage,
} from "../types";
import { InventoryDraftCard } from "./InventoryDraftCard";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  MultimodalInput,
  type Attachment,
  FARMER_SUGGESTED_ACTIONS,
  RESTAURANT_SUGGESTED_ACTIONS,
} from "@/components/ui/multimodal-ai-chat-input";
import { useAuth0 } from "@auth0/auth0-react";
import CFG from "@/config";
import { useListingActions, type ParsedSheetLineItem } from "@/hooks/useListingActions";
import { InteractiveCheckout, type CartItem, type Product as CheckoutProduct, type ProductUnit } from "@/components/ui/interactive-checkout";
import { CheckoutForm } from "@/components/ui/checkout-form";
import { OrderConfirmationCard } from "@/components/ui/order-confirmation-card";
import { cn } from "@/lib/utils";

/** First line of assistant messages that represent a completed mock checkout (used for styling). */
const MOCK_ORDER_FIRST_LINE = "Mock order placed";

/** Many mobile browsers leave `File.type` empty or use `application/octet-stream` for camera JPEGs. */
function isChatImageAttachment(a: Attachment): boolean {
  if (!a.file) return false;
  const mime = (a.file.type || a.contentType || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  if (mime === "" || mime === "application/octet-stream") {
    return /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(a.file.name);
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Parse "2kg of tomatoes" / "3 lb greens" from the user query        */
/* ------------------------------------------------------------------ */

interface RequestedAmount {
  qty: number;
  unit: ProductUnit;
  /** Lowercased keyword(s) the user mentioned (e.g. "tomatoes", "greens mix"). */
  keyword: string;
}

const QTY_UNIT_RE =
  /(\d+(?:\.\d+)?)\s*(kg|kgs|lb|lbs|pound|pounds|count|ct|bunch)\b(?:\s+(?:of\s+)?)?([\w\s]{2,}?)(?:\s+and\b|\s*,|$)/gi;

function parseRequestedAmounts(query: string): RequestedAmount[] {
  const results: RequestedAmount[] = [];
  let m: RegExpExecArray | null;
  while ((m = QTY_UNIT_RE.exec(query)) !== null) {
    const rawUnit = m[2].toLowerCase();
    let unit: ProductUnit;
    if (rawUnit === "lb" || rawUnit === "lbs" || rawUnit === "pound" || rawUnit === "pounds") unit = "lb";
    else if (rawUnit === "kg" || rawUnit === "kgs") unit = "kg";
    else if (rawUnit === "ct" || rawUnit === "count") unit = "count";
    else unit = rawUnit as ProductUnit;

    const keyword = m[3].trim().toLowerCase();
    if (keyword) {
      results.push({ qty: parseFloat(m[1]), unit, keyword });
    }
  }
  return results;
}

function matchRequestedAmount(
  itemTitle: string,
  itemCategory: string,
  amounts: RequestedAmount[],
): RequestedAmount | undefined {
  const title = itemTitle.toLowerCase();
  const category = itemCategory.toLowerCase();
  return amounts.find(
    (a) => title.includes(a.keyword) || category.includes(a.keyword) || a.keyword.includes(title) || a.keyword.includes(category),
  );
}

/** Fix common typos like "2kg or cucumbers" → "2kg of cucumbers" before parsing. */
function normalizeOrderTextForParsing(input: string): string {
  return input.replace(
    /\b(\d+(?:\.\d+)?\s*(?:kg|kgs|lb|lbs|pound|pounds|count|ct|bunch))\s+or\s+/gi,
    "$1 of ",
  );
}

/**
 * Turn a natural-language restaurant order into optimizer line items
 * (same shape as CSV parsing). Uses the same qty/unit patterns as product-grid matching.
 */
function textOrderToLineItems(input: string): ParsedSheetLineItem[] {
  const normalized = normalizeOrderTextForParsing(input);
  const amounts = parseRequestedAmounts(normalized);
  const out: ParsedSheetLineItem[] = [];
  const seen = new Set<string>();
  for (const a of amounts) {
    const name = a.keyword
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.,;:!?]+$/g, "");
    if (name.length < 2) continue;
    const dedupeKey = `${name.toLowerCase()}:${a.unit}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const titled = name.charAt(0).toUpperCase() + name.slice(1);
    out.push({
      item: titled,
      qtyNeeded: a.qty,
      unit: a.unit,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */

interface ChatInterfaceProps {
  role: UserRole | undefined;
  chatId: string | null;
  onPostInventory?: (draft: InventoryDraftData) => void;
  onClearPostError?: () => void;
}

export function ChatInterface({
  role = "farmer",
  chatId,
  onPostInventory,
  onClearPostError,
}: ChatInterfaceProps) {
  const { isAuthenticated, getAccessTokenSilently } = useAuth0();
  const { uploadImage, parseSourcingSheet, runOptimizer } = useListingActions();
  const { messages, isThinking, sendMessage, cancelThinking, pushMessages, setThinking, persistMessage } = useAgent({
    role,
    chatId,
  });
  const theme = getAgentTheme(role);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const cartLoadedForChatIdRef = useRef<string | null>(null);
  const lastSavedCartRef = useRef<string>("[]");
  const saveTimerRef = useRef<number | null>(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [checkoutTotal, setCheckoutTotal] = useState<number | null>(null);
  /** Echoed on confirmation card after mock checkout (cart is cleared, so total is stored here). */
  const [lastPlacedOrder, setLastPlacedOrder] = useState<{ orderId: string; total: number } | null>(
    null,
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, isThinking]);

  const AgentIcon = role === "farmer" ? Tractor : ChefHat;

  const generateMsgId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  /** Shared by CSV upload and natural-language restaurant orders. */
  const runSourcingOptimizationFromLineItems = useCallback(
    async (lineItems: ParsedSheetLineItem[]) => {
      try {
        const plan = await runOptimizer(lineItems);
        const planData = plan as unknown as {
          strategyOptions?: StrategyOptionItem[];
          recommendedStrategyId?: string | null;
          strategies?: Array<{ id: string; name: string; allocations: StrategyAllocation[] }>;
          unfulfillable?: Array<{
            lineItemName: string;
            qtyNeeded: number;
            qtyAvailable: number;
            reason: string;
          }>;
          summary?: string;
          reasoning?: string;
          orderId?: string;
        };

        const options = planData.strategyOptions ?? [];
        if (options.length === 0) {
          const headline = planData.summary || "No fulfillment strategies could be generated.";
          const tips = [
            "Check that suppliers have listed items matching your order",
            "Try broadening your order with more common produce names",
            "Rephrase your order (e.g. 2 kg of tomatoes and 1 lb of greens) or upload a CSV",
          ];
          const noStratContent = `${headline}\n\nThis usually means there aren't enough supply listings to match your order. Here are some things to try:\n\n${tips.map((t) => `• ${t}`).join("\n")}`;
          pushMessages({
            id: generateMsgId(),
            role: "assistant",
            type: "text",
            content: noStratContent,
            createdAt: new Date(),
          });
          void persistMessage({ role: "assistant", type: "text", content: noStratContent });
          return;
        }

        const sourcingPlan: SourcingPlanData = {
          orderId: planData.orderId ?? "",
          strategies: (planData.strategies ?? []).map((s) => ({
            id: s.id,
            name: s.name,
            allocations: s.allocations,
          })),
          unfulfillable: planData.unfulfillable ?? [],
          summary: planData.summary ?? "",
          reasoning: planData.reasoning ?? "",
        };

        const strategyMsg: StrategyOptionsMessage = {
          id: generateMsgId(),
          role: "assistant",
          type: "strategy_options",
          createdAt: new Date(),
          options,
          recommendedStrategyId: planData.recommendedStrategyId ?? null,
          sourcingPlan: sourcingPlan,
        };

        pushMessages(strategyMsg);
        void persistMessage({
          role: "assistant",
          type: "strategy_options",
          options,
          recommendedStrategyId: planData.recommendedStrategyId ?? null,
          sourcingPlan,
        });
      } catch (err) {
        console.error("Optimization failed:", err);
        const failContent = `Optimization failed: ${err instanceof Error ? err.message : "Unknown error"}. You can try again or describe your order in text.`;
        pushMessages({
          id: generateMsgId(),
          role: "assistant",
          type: "text",
          content: failContent,
          createdAt: new Date(),
        });
        void persistMessage({ role: "assistant", type: "text", content: failContent });
      } finally {
        setThinking(false);
      }
    },
    [runOptimizer, pushMessages, persistMessage, setThinking],
  );

  const handleMockPlaceOrder = useCallback(() => {
    const snapshot = [...cart];
    if (snapshot.length === 0) return;

    const total =
      checkoutTotal ??
      Math.round(snapshot.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100;
    const orderId = `MOCK-${Math.floor(10000000 + Math.random() * 90000000)}`;

    const lines = snapshot.map((item) => {
      const u = item.unit ?? "kg";
      const qtyStr =
        u === "count" || u === "bunch"
          ? String(Math.round(item.quantity))
          : item.quantity.toFixed(2);
      const unitLabel = u === "count" ? "ct" : u === "bunch" ? "bunch" : u;
      const lineTotal = (item.price * item.quantity).toFixed(2);
      return `• ${item.name} — ${qtyStr} ${unitLabel} — $${lineTotal}`;
    });

    const content = [
      MOCK_ORDER_FIRST_LINE,
      "",
      `Order ID: ${orderId}`,
      `Total: $${total.toFixed(2)}`,
      "",
      "Items:",
      ...lines,
      "",
      "This is a demo checkout; no real payment was processed.",
    ].join("\n");

    const msg: TextMessage = {
      id: generateMsgId(),
      role: "assistant",
      type: "text",
      content,
      createdAt: new Date(),
    };
    pushMessages(msg);
    void persistMessage({ role: "assistant", type: "text", content });

    setLastPlacedOrder({ orderId, total });
    setShowConfirmation(true);
    setCart([]);
  }, [cart, checkoutTotal, pushMessages, persistMessage]);

  const handleSendMessage = useCallback(
    async ({ input, attachments }: { input: string; attachments: Attachment[] }) => {
      const trimmed = input.trim();
      if (!chatId) return;
      onClearPostError?.();
      if (!trimmed && attachments.length === 0) return;

      const isSheetAttachment = (a: Attachment): boolean => {
        const name = a.name.toLowerCase();
        const type = (a.contentType ?? "").toLowerCase();
        return (
          name.endsWith(".csv") ||
          type === "text/csv" ||
          type === "application/csv"
        );
      };

      const sheetAttachment = attachments.find((a) => a.file && isSheetAttachment(a));

      if (role === "restaurant" && sheetAttachment?.file) {
        const userContent = trimmed || `Uploaded ${sheetAttachment.name} for optimization`;
        const userMsg: AgentMessage = {
          id: generateMsgId(),
          role: "user",
          type: "text",
          content: userContent,
          createdAt: new Date(),
        };
        pushMessages(userMsg);
        void persistMessage({ role: "user", type: "text", content: userContent });
        setThinking(true);

        try {
          const parsed = await parseSourcingSheet(sheetAttachment.file);
          if (!parsed.lineItems.length) {
            const parseErrorContent = "Could not parse any valid items from the CSV. Please check the file has 'item' and 'qty' columns.";
            pushMessages({
              id: generateMsgId(),
              role: "assistant",
              type: "text",
              content: parseErrorContent,
              createdAt: new Date(),
            });
            void persistMessage({ role: "assistant", type: "text", content: parseErrorContent });
            setThinking(false);
            return;
          }

          await runSourcingOptimizationFromLineItems(parsed.lineItems);
        } catch (err) {
          console.error("CSV sourcing failed:", err);
          const failContent = `Could not process the sheet: ${err instanceof Error ? err.message : "Unknown error"}.`;
          pushMessages({
            id: generateMsgId(),
            role: "assistant",
            type: "text",
            content: failContent,
            createdAt: new Date(),
          });
          void persistMessage({ role: "assistant", type: "text", content: failContent });
          setThinking(false);
        }
        return;
      }

      /* Natural-language order → same optimization path as CSV (restaurant). */
      if (role === "restaurant" && trimmed && !sheetAttachment) {
        const lineItems = textOrderToLineItems(trimmed);
        if (lineItems.length > 0) {
          const userMsg: AgentMessage = {
            id: generateMsgId(),
            role: "user",
            type: "text",
            content: trimmed,
            createdAt: new Date(),
          };
          pushMessages(userMsg);
          void persistMessage({ role: "user", type: "text", content: trimmed });
          setThinking(true);
          await runSourcingOptimizationFromLineItems(lineItems);
          return;
        }
      }

      let imageId: string | undefined;
      const imageAttachment = attachments.find((a) => isChatImageAttachment(a));
      if (imageAttachment?.file) {
        try {
          const res = await uploadImage(imageAttachment.file);
          imageId = res.imageId;
        } catch (err) {
          console.error("Failed to upload chat image:", err);
        }
      }

      const textToSend = trimmed || (imageId ? "Create listing from this photo" : "");
      if (textToSend || imageId) sendMessage(textToSend, imageId ? { imageId } : undefined);
    },
    [
      chatId,
      sendMessage,
      onClearPostError,
      uploadImage,
      parseSourcingSheet,
      role,
      pushMessages,
      setThinking,
      persistMessage,
      runSourcingOptimizationFromLineItems,
    ]
  );

  const handleSelectStrategy = useCallback(
    (msg: StrategyOptionsMessage, strategyId: string) => {
      const strat = msg.sourcingPlan.strategies.find((s) => s.id === strategyId);
      if (!strat || strat.allocations.length === 0) return;

      const items: ProductGridItem[] = strat.allocations.map((alloc, idx) => ({
        id: `alloc-${idx}-${alloc.supplier.listingId}`,
        listingId: alloc.supplier.listingId,
        title: alloc.supplier.title,
        item: alloc.supplier.item,
        price: alloc.supplier.pricePerUnit,
        qty: alloc.allocatedQty,
        unit: alloc.unit,
        farmerName: alloc.supplier.supplierName,
        farmerId: alloc.supplier.supplierId,
        imageId: alloc.supplier.imageId,
        imageUrl: alloc.supplier.imageId
          ? `${CFG.API_URL}/api/images/${alloc.supplier.imageId}`
          : undefined,
        deliveryWindow: alloc.deliveryWindow,
        matchType: alloc.matchType,
        matchScore: alloc.matchScore,
      }));

      const autoCart: CartItem[] = items.map((item, index): CartItem => ({
        id: item.id || `agent-${index}`,
        listingId: item.listingId || item.id,
        name: item.title,
        price: item.price,
        category: item.item,
        image:
          item.imageUrl ??
          "https://images.unsplash.com/photo-1567306226416-28f0efdc88ce?auto=format&fit=crop&w=600&q=80",
        color: item.farmerName ?? "",
        unit: (item.unit as ProductUnit) ?? "kg",
        availableQty: item.qty,
        deliveryWindow: item.deliveryWindow,
        quantity: item.qty,
      }));
      setCart(autoCart);

      const unfulfillable = msg.sourcingPlan.unfulfillable.length > 0
        ? msg.sourcingPlan.unfulfillable
        : undefined;

      const selectContent = `Here are the allocations for the "${strat.name}" strategy:`;
      pushMessages(
        {
          id: generateMsgId(),
          role: "assistant",
          type: "text",
          content: selectContent,
          createdAt: new Date(),
        },
        {
          id: generateMsgId(),
          role: "assistant",
          type: "product_grid",
          query: "",
          items,
          unfulfillable,
          createdAt: new Date(),
        }
      );
      void persistMessage({ role: "assistant", type: "text", content: selectContent });
      void persistMessage({ role: "assistant", type: "product_grid", items });
    },
    [pushMessages, persistMessage]
  );

  const suggestedActions =
    role === "farmer" ? FARMER_SUGGESTED_ACTIONS : RESTAURANT_SUGGESTED_ACTIONS;

  const getAuthHeaders = useCallback(async () => {
    const token = await getAccessTokenSilently({
      authorizationParams: { audience: CFG.AUTH0_AUDIENCE },
    });
    return { Authorization: `Bearer ${token}` };
  }, [getAccessTokenSilently]);

  // Load persisted cart per (user, chatId)
  useEffect(() => {
    let isCancelled = false;

    async function loadCart() {
      if (!chatId || !isAuthenticated) {
        setCart([]);
        cartLoadedForChatIdRef.current = chatId;
        lastSavedCartRef.current = "[]";
        return;
      }
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${CFG.API_URL}/api/glean/chats/${chatId}/cart`, { headers });
        if (!res.ok) throw new Error(`Failed to load cart (${res.status})`);
        const data = (await res.json()) as { items?: CartItem[] };
        const items = Array.isArray(data?.items) ? data.items : [];
        if (!isCancelled) {
          setCart(items);
          cartLoadedForChatIdRef.current = chatId;
          lastSavedCartRef.current = JSON.stringify(items);
        }
      } catch (err) {
        console.error("Failed to load Glean cart:", err);
      }
    }

    void loadCart();
    return () => {
      isCancelled = true;
    };
  }, [chatId, getAuthHeaders, isAuthenticated]);

  // Persist cart updates (debounced)
  useEffect(() => {
    if (!chatId || !isAuthenticated) return;
    if (cartLoadedForChatIdRef.current !== chatId) return;

    const serialized = JSON.stringify(cart);
    if (serialized === lastSavedCartRef.current) return;

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`${CFG.API_URL}/api/glean/chats/${chatId}/cart`, {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ items: cart }),
        });
        if (res.ok) lastSavedCartRef.current = serialized;
      } catch (err) {
        console.error("Failed to save Glean cart:", err);
      }
    }, 500);

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [cart, chatId, getAuthHeaders, isAuthenticated]);

  return (
    <div className="flex flex-col h-full min-h-0 rounded-2xl border border-zinc-200 bg-zinc-50/50">
      {/* Header — minimal, ChatGPT-style */}
      <header className="shrink-0 flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-zinc-200 bg-white rounded-t-2xl">
        <Avatar className={cn("h-9 w-9", theme.primaryBg, "text-white")}>
          <AvatarFallback className={cn("bg-transparent text-white")}>
            <AgentIcon className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
        <p className="text-sm text-zinc-600 truncate min-w-0 flex-1">
          {role === "farmer"
            ? "Describe your harvest — I'll draft a listing."
            : "Describe what you need — I'll find matches."}
        </p>
      </header>

      {/* Messages — scrollable, clean (plain overflow so ref works) */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 px-1.5 sm:px-3 md:px-4 py-4 min-h-full">
          {!chatId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center min-h-[200px]">
              <p className="text-sm text-zinc-500">Loading your chat…</p>
            </div>
          ) : (
            <>
              {messages.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-center min-h-[200px]">
                  <p className="text-sm text-zinc-500 max-w-[280px]">
                    {role === "farmer"
                      ? "Try: “Just harvested 50kg of ugly carrots.”"
                      : "Try: “2 kg of tomatoes and 3 lb of greens” or attach a CSV for sourcing strategies."}
                  </p>
                </div>
              )}

              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  chatId={chatId}
                  theme={theme}
                  AgentIcon={AgentIcon}
                  onPostInventory={onPostInventory}
                  onSelectStrategy={handleSelectStrategy}
                  cart={cart}
                  onCartChange={setCart}
                  onCheckout={({ cart: checkoutCart, total }) => {
                    if (!checkoutCart.length) return;
                    setCheckoutTotal(total);
                    setIsCheckoutOpen(true);
                    setShowConfirmation(false);
                  }}
                />
              ))}

              <AnimatePresence>
                {isThinking && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-start gap-3"
                  >
                    <Avatar className="h-8 w-8 shrink-0 rounded-full bg-zinc-200">
                      <AvatarFallback className="bg-transparent text-zinc-600">
                        <Bot className="h-4 w-4" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex items-center gap-2 py-2 px-3 rounded-2xl rounded-bl-md bg-zinc-100 text-zinc-600 text-sm">
                      <span className="inline-flex gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:0ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:150ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:300ms]" />
                      </span>
                      <span>Thinking...</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </div>
      </div>

      {/* Input — multimodal with role-based suggested actions */}
      <div className="shrink-0 px-1.5 sm:px-3 md:px-4 py-3 sm:py-4 border-t border-zinc-200 bg-white rounded-b-2xl">
        <MultimodalInput
          suggestedActions={suggestedActions}
          attachments={attachments}
          setAttachments={setAttachments}
          onSendMessage={handleSendMessage}
          onStopGenerating={cancelThinking ?? (() => {})}
          isGenerating={isThinking}
          canSend={Boolean(chatId)}
          placeholder={
            role === "farmer"
              ? "Describe what you've harvested..."
              : "Type an order (e.g. 2 kg cucumbers and 2 kg tomatoes) or attach a CSV…"
          }
          draftKey={chatId ? `glean:draft:${chatId}` : undefined}
        />
      </div>

      {/* Mock checkout overlay */}
      {isCheckoutOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close checkout"
            className="absolute inset-0 w-full h-full cursor-default"
            onClick={() => {
              setShowConfirmation(false);
              setIsCheckoutOpen(false);
              setCheckoutTotal(null);
              setLastPlacedOrder(null);
            }}
          />
          <div className="relative z-10 w-full max-w-md px-4">
            {!showConfirmation ? (
              <div className="rounded-2xl bg-white shadow-2xl border border-zinc-200 p-4 sm:p-5">
                <CheckoutForm
                  totalAmount={
                    checkoutTotal ?? cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
                  }
                  items={cart.map((item) => ({
                    id: item.id,
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price,
                  }))}
                  onCancel={() => {
                    setIsCheckoutOpen(false);
                    setShowConfirmation(false);
                    setCheckoutTotal(null);
                    setLastPlacedOrder(null);
                  }}
                  onPlaceOrder={handleMockPlaceOrder}
                />
              </div>
            ) : (
              <OrderConfirmationCard
                orderId={lastPlacedOrder?.orderId ?? "MOCK-00000000"}
                paymentMethod="Mock payment"
                dateTime={new Date().toLocaleString()}
                totalAmount={`$${(lastPlacedOrder?.total ?? 0).toFixed(2)}`}
                title="Your mock order has been placed"
                buttonText="Back to Glean"
                onClose={() => {
                  setShowConfirmation(false);
                  setIsCheckoutOpen(false);
                  setLastPlacedOrder(null);
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface MessageBubbleProps {
  message: AgentMessage;
  chatId: string | null;
  theme: ReturnType<typeof getAgentTheme>;
  AgentIcon: typeof Bot;
  onPostInventory?: (draft: InventoryDraftData) => void;
  onSelectStrategy?: (msg: StrategyOptionsMessage, strategyId: string) => void;
  cart: CartItem[];
  onCartChange: (cart: CartItem[]) => void;
  onCheckout: (params: { cart: CartItem[]; total: number }) => void;
}

const STRATEGY_ICONS: Record<string, typeof DollarSign> = {
  "Lowest Cost": DollarSign,
  "Highest Quality": Award,
  "Fastest Delivery": Zap,
  "Fewest Suppliers": LayoutGrid,
};

function getStrategyIcon(name: string) {
  for (const [key, Icon] of Object.entries(STRATEGY_ICONS)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return Icon;
  }
  return LayoutGrid;
}

function StrategyCard({
  option,
  isRecommended,
  isSelected,
  onSelect,
}: {
  option: StrategyOptionItem;
  isRecommended: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const Icon = getStrategyIcon(option.name);
  const m = option.metrics;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative flex flex-col gap-2 rounded-xl border-2 p-3 sm:p-4 text-left transition-all hover:shadow-md",
        isSelected
          ? "border-emerald-500 bg-emerald-50 shadow-md"
          : isRecommended
            ? "border-amber-400 bg-amber-50/50 hover:border-amber-500"
            : "border-zinc-200 bg-white hover:border-zinc-300"
      )}
    >
      {isRecommended && !isSelected && (
        <span className="absolute -top-2.5 right-3 inline-flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-semibold text-white">
          <Star className="h-3 w-3" /> Recommended
        </span>
      )}
      {isSelected && (
        <span className="absolute -top-2.5 right-3 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">
          <CheckCircle2 className="h-3 w-3" /> Selected
        </span>
      )}

      <div className="flex items-center gap-2">
        <div className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          isSelected ? "bg-emerald-100 text-emerald-600" : "bg-zinc-100 text-zinc-600"
        )}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900 truncate">{option.name}</p>
        </div>
      </div>

      <p className="text-xs text-zinc-500 line-clamp-2">{option.description}</p>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div>
          <span className="text-zinc-400">Cost</span>
          <span className="ml-1 font-medium text-zinc-700">${m.totalCost.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-zinc-400">Coverage</span>
          <span className={cn(
            "ml-1 font-medium inline-flex items-center gap-0.5",
            m.coveragePercent >= 100
              ? "text-emerald-600"
              : m.coveragePercent >= 80
                ? "text-amber-600"
                : "text-red-600",
          )}>
            {m.coveragePercent < 100 && <AlertTriangle className="inline h-3 w-3" />}
            {m.coveragePercent.toFixed(0)}%
          </span>
        </div>
        <div>
          <span className="text-zinc-400">Suppliers</span>
          <span className="ml-1 font-medium text-zinc-700">{m.supplierCount}</span>
        </div>
        <div>
          <span className="text-zinc-400">Match</span>
          <span className="ml-1 font-medium text-zinc-700">{(m.avgMatchScore * 100).toFixed(0)}%</span>
        </div>
      </div>

      {option.tradeoffs.length > 0 && (
        <ul className="text-[11px] text-zinc-400 space-y-0.5">
          {option.tradeoffs.slice(0, 2).map((t, i) => (
            <li key={i}>• {t}</li>
          ))}
        </ul>
      )}
    </button>
  );
}

function MessageBubble({
  message,
  chatId,
  theme,
  AgentIcon,
  onPostInventory,
  onSelectStrategy,
  cart,
  onCartChange,
  onCheckout,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isReasoningOpen, setIsReasoningOpen] = useState(false);

  if (isUser) {
    const content = message.type === "text" ? message.content : "";
    return (
      <div className="flex justify-end">
        <div className="flex items-end gap-2 max-w-[85%]">
          <div className="rounded-2xl rounded-br-md px-4 py-2.5 bg-zinc-900 text-white text-sm">
            <p className="whitespace-pre-wrap break-words">{content}</p>
          </div>
          <Avatar className="h-8 w-8 shrink-0 rounded-full bg-zinc-900">
            <AvatarFallback className="bg-transparent text-white">
              <User className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <Avatar className={cn("h-8 w-8 shrink-0 rounded-full", theme.primaryBg, "text-white")}>
        <AvatarFallback className="bg-transparent text-white">
          <AgentIcon className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-3">
        {message.type === "text" && (
          message.content.startsWith(MOCK_ORDER_FIRST_LINE) ? (
            <div className="rounded-2xl rounded-bl-md border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-zinc-900 shadow-sm">
              <div className="flex items-start gap-2.5">
                <PackageCheck className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" aria-hidden />
                <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl rounded-bl-md px-4 py-2.5 bg-zinc-100 text-zinc-900 text-sm">
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
              {message.isStreaming && (
                <span className="inline-block w-2 h-4 ml-0.5 bg-zinc-400 animate-pulse align-middle rounded" />
              )}
            </div>
          )
        )}
        {message.type === "strategy_options" && (() => {
          const stratMsg = message as StrategyOptionsMessage;
          const fmtQty = (n: number) => n.toFixed(2);
          return (
            <div className="rounded-2xl rounded-bl-md border border-zinc-200 bg-zinc-50 px-3 py-3 sm:px-4 sm:py-4 space-y-3">
              {stratMsg.sourcingPlan.summary && (
                <p className="text-sm text-zinc-700">{stratMsg.sourcingPlan.summary}</p>
              )}

              {stratMsg.sourcingPlan.unfulfillable.length > 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Some items cannot be fully fulfilled
                  </div>
                  <div className="text-xs text-amber-700 space-y-0.5 pl-5">
                    {stratMsg.sourcingPlan.unfulfillable.map((u, i) => (
                      <p key={i}>
                        <span className="font-medium">{u.lineItemName}</span>
                        {u.qtyAvailable === 0
                          ? " — no matching suppliers found"
                          : ` — ${fmtQty(u.qtyAvailable)} of ${fmtQty(u.qtyNeeded)} available`}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {stratMsg.sourcingPlan.reasoning && (
                <div>
                  <button
                    type="button"
                    onClick={() => setIsReasoningOpen((v) => !v)}
                    className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 transition-colors"
                  >
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 transition-transform duration-150",
                        isReasoningOpen && "rotate-90",
                      )}
                    />
                    <Info className="h-3.5 w-3.5" />
                    Why this recommendation?
                  </button>
                  <AnimatePresence>
                    {isReasoningOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-2 ml-5 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600">
                          <p className="whitespace-pre-wrap">{stratMsg.sourcingPlan.reasoning}</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                Select a sourcing strategy
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {stratMsg.options
                  .sort((a, b) => a.rank - b.rank)
                  .map((opt) => (
                    <StrategyCard
                      key={opt.strategyId}
                      option={opt}
                      isRecommended={opt.strategyId === stratMsg.recommendedStrategyId}
                      isSelected={selectedId === opt.strategyId}
                      onSelect={() => {
                        setSelectedId(opt.strategyId);
                        onSelectStrategy?.(stratMsg, opt.strategyId);
                      }}
                    />
                  ))}
              </div>
            </div>
          );
        })()}
        {message.type === "product_grid" && (() => {
          const requested = parseRequestedAmounts(message.query);
          const fmtQty = (n: number) => n.toFixed(2);
          return (
          <div className="rounded-2xl rounded-bl-md border border-zinc-200 bg-white px-1 py-1.5 sm:px-3 sm:py-3 space-y-3">
            {message.unfulfillable && message.unfulfillable.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Items not fully sourced
                </div>
                <div className="text-xs text-amber-700 space-y-0.5 pl-5">
                  {message.unfulfillable.map((u, i) => (
                    <p key={i}>
                      <span className="font-medium">{u.lineItemName}</span>
                      {u.qtyAvailable === 0
                        ? " — no suppliers found"
                        : ` — ${fmtQty(u.qtyAvailable)} of ${fmtQty(u.qtyNeeded)} sourced`}
                    </p>
                  ))}
                </div>
              </div>
            )}
            <InteractiveCheckout
              products={message.items.map((item, index): CheckoutProduct => {
                const match = matchRequestedAmount(item.title, item.item, requested);
                return {
                  id: item.id || `agent-${index}`,
                  listingId: item.listingId || item.id,
                  name: item.title,
                  price: item.price,
                  category: item.item,
                  image:
                    item.imageUrl ??
                    "https://images.unsplash.com/photo-1567306226416-28f0efdc88ce?auto=format&fit=crop&w=600&q=80",
                  color: item.farmerName ?? "",
                  unit: (item.unit as ProductUnit) ?? "kg",
                  availableQty: item.qty,
                  ...(match
                    ? { requestedQty: match.qty, requestedUnit: match.unit }
                    : { requestedQty: item.qty }),
                  deliveryWindow: item.deliveryWindow,
                  matchType: item.matchType,
                  matchScore: item.matchScore,
                };
              })}
              cart={cart}
              onCartChange={onCartChange}
              onCheckout={onCheckout}
              storageKey={chatId ? `glean:checkout:${chatId}:${message.items.map((i) => i.listingId || i.id).sort().join(",")}` : undefined}
            />
          </div>
          );
        })()}
        {message.type === "inventory_form" && (
          <InventoryDraftCard
            draft={message.draft}
            draftMessageId={message.id}
            primaryButtonClass={theme.primaryButtonClass}
            onPost={(draft) => onPostInventory?.(draft)}
          />
        )}
      </div>
    </div>
  );
}
