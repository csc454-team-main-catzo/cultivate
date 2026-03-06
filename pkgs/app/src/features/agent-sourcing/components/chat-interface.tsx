import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Tractor, ChefHat, Bot, User } from "lucide-react";
import { useAgent } from "../hooks/useAgent";
import { getAgentTheme } from "../lib/theme";
import type {
  AgentMessage,
  InventoryDraftData,
  ProductGridItem,
  UserRole,
} from "../types";
import { ProductCard } from "./ProductCard";
import { InventoryDraftCard } from "./InventoryDraftCard";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  MultimodalInput,
  type Attachment,
  FARMER_SUGGESTED_ACTIONS,
  RESTAURANT_SUGGESTED_ACTIONS,
} from "@/components/ui/multimodal-ai-chat-input";
import { cn } from "@/lib/utils";

interface ChatInterfaceProps {
  role: UserRole | undefined;
  onPostInventory?: (draft: InventoryDraftData) => void;
  onAddToOrder?: (item: ProductGridItem) => void;
  onNegotiate?: (item: ProductGridItem) => void;
}

export function ChatInterface({
  role = "farmer",
  onPostInventory,
  onAddToOrder,
  onNegotiate,
}: ChatInterfaceProps) {
  const { messages, isThinking, sendMessage, cancelThinking } = useAgent({ role });
  const theme = getAgentTheme(role);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, isThinking]);

  const AgentIcon = role === "farmer" ? Tractor : ChefHat;

  const handleSendMessage = useCallback(
    ({ input }: { input: string; attachments: Attachment[] }) => {
      const trimmed = input.trim();
      if (trimmed) sendMessage(trimmed);
      // Attachments could be used for image-based listing (future)
    },
    [sendMessage]
  );

  const suggestedActions =
    role === "farmer" ? FARMER_SUGGESTED_ACTIONS : RESTAURANT_SUGGESTED_ACTIONS;

  return (
    <div className="flex flex-col h-full min-h-[480px] max-h-[calc(100vh-12rem)] rounded-2xl border border-zinc-200 bg-zinc-50/50">
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
              onAddToOrder={onAddToOrder}
              onNegotiate={onNegotiate}
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
          canSend={true}
          placeholder={
            role === "farmer"
              ? "Describe what you've harvested..."
              : "Describe what you need..."
          }
        />
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: AgentMessage;
  theme: ReturnType<typeof getAgentTheme>;
  AgentIcon: typeof Bot;
  onPostInventory?: (draft: InventoryDraftData) => void;
  onAddToOrder?: (item: ProductGridItem) => void;
  onNegotiate?: (item: ProductGridItem) => void;
}

function MessageBubble({
  message,
  theme,
  AgentIcon,
  onPostInventory,
  onAddToOrder,
  onNegotiate,
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {message.items.map((item) => (
              <ProductCard
                key={item.id}
                item={item}
                primaryButtonClass={theme.primaryButtonClass}
                onAddToOrder={onAddToOrder}
                onNegotiate={onNegotiate}
              />
            ))}
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
