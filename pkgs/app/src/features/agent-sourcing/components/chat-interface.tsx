import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Tractor, ChefHat, Bot, User } from "lucide-react";
import { useAgent } from "../hooks/useAgent";
import { getAgentTheme } from "../lib/theme";
import type {
  AgentMessage,
  InventoryDraftData,
  UserRole,
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
import { useListingActions } from "@/hooks/useListingActions";
import { InteractiveCheckout, type CartItem, type Product as CheckoutProduct } from "@/components/ui/interactive-checkout";
import { CheckoutForm } from "@/components/ui/checkout-form";
import { OrderConfirmationCard } from "@/components/ui/order-confirmation-card";
import { cn } from "@/lib/utils";

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
  const { uploadImage } = useListingActions();
  const { messages, isThinking, sendMessage, cancelThinking } = useAgent({
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, isThinking]);

  const AgentIcon = role === "farmer" ? Tractor : ChefHat;

  const handleSendMessage = useCallback(
    async ({ input, attachments }: { input: string; attachments: Attachment[] }) => {
      const trimmed = input.trim();
      if (!chatId) return;
      onClearPostError?.();
      if (!trimmed && attachments.length === 0) return;
      let imageId: string | undefined;
      const imageAttachment = attachments.find(
        (a) => a.file && a.contentType?.startsWith("image/")
      );
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
    [chatId, sendMessage, onClearPostError, uploadImage]
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
      <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-zinc-200 bg-white rounded-t-2xl">
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
        <div className="flex flex-col gap-4 px-4 py-4 min-h-full">
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
                      : "Try: “Need 20kg carrots by Friday.”"}
                  </p>
                </div>
              )}

              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  theme={theme}
                  AgentIcon={AgentIcon}
                  onPostInventory={onPostInventory}
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
      <div className="shrink-0 px-4 py-4 border-t border-zinc-200 bg-white rounded-b-2xl">
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
              : "Describe what you need..."
          }
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
                  }}
                  onPlaceOrder={() => {
                    setShowConfirmation(true);
                    // Clear cart after a mock order is placed
                    setCart([]);
                  }}
                />
              </div>
            ) : (
              <OrderConfirmationCard
                orderId="MOCK-57625869"
                paymentMethod="Mock payment"
                dateTime={new Date().toLocaleString()}
                totalAmount={`$${(
                  checkoutTotal ?? cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
                ).toFixed(2)}`}
                title="Your mock order has been placed"
                buttonText="Back to Glean"
                onClose={() => {
                  setShowConfirmation(false);
                  setIsCheckoutOpen(false);
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
  theme: ReturnType<typeof getAgentTheme>;
  AgentIcon: typeof Bot;
  onPostInventory?: (draft: InventoryDraftData) => void;
  cart: CartItem[];
  onCartChange: (cart: CartItem[]) => void;
  onCheckout: (params: { cart: CartItem[]; total: number }) => void;
}

function MessageBubble({
  message,
  theme,
  AgentIcon,
  onPostInventory,
  cart,
  onCartChange,
  onCheckout,
}: MessageBubbleProps) {
  const isUser = message.role === "user";

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
          <div className="rounded-2xl rounded-bl-md px-4 py-2.5 bg-zinc-100 text-zinc-900 text-sm">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
            {message.isStreaming && (
              <span className="inline-block w-2 h-4 ml-0.5 bg-zinc-400 animate-pulse align-middle rounded" />
            )}
          </div>
        )}
        {message.type === "product_grid" && (
          <div className="rounded-2xl rounded-bl-md border border-zinc-200 bg-white px-3 py-3 sm:px-4 sm:py-4">
            <InteractiveCheckout
              products={message.items.map((item, index): CheckoutProduct => ({
                id: item.id || `agent-${index}`,
                name: item.title,
                price: item.price,
                category: item.item,
                image:
                  item.imageUrl ??
                  "https://images.unsplash.com/photo-1567306226416-28f0efdc88ce?auto=format&fit=crop&w=600&q=80",
                color: item.unit ?? "kg",
                deliveryWindow: item.deliveryWindow,
              }))}
              cart={cart}
              onCartChange={onCartChange}
              onCheckout={onCheckout}
            />
          </div>
        )}
        {message.type === "inventory_form" && (
          <InventoryDraftCard
            draft={message.draft}
            primaryButtonClass={theme.primaryButtonClass}
            onPost={(draft) => onPostInventory?.(draft)}
          />
        )}
      </div>
    </div>
  );
}
