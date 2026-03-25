import { useCallback, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { useUser } from "../providers/userContext";
import { useListingActions } from "../hooks/useListingActions";
import { ChatInterface } from "../features/agent-sourcing/components/chat-interface";
import { GleanChatSidebar } from "../features/agent-sourcing/components/GleanChatSidebar";
import { useGleanChats } from "../features/agent-sourcing/hooks/useGleanChats";
import { getUserRole } from "../lib/auth";
import { Button } from "../components/ui/button";
import type { InventoryDraftData, ListingPostSuccessInfo } from "../features/agent-sourcing/types";

export default function AgentSourcing() {
  const { user } = useUser();
  const { createListing } = useListingActions();
  const role = getUserRole(user ?? null) ?? "farmer";

  const {
    chats,
    activeChatId,
    isLoading: chatsLoading,
    error: chatLoadError,
    setActiveChatId,
    createChat,
    renameChat,
    deleteChat,
  } = useGleanChats(role);

  const noChats = !chatsLoading && chats.length === 0;

  const [postError, setPostError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handlePostInventory = useCallback(
    async (draft: InventoryDraftData): Promise<ListingPostSuccessInfo | undefined> => {
      try {
        const description = (draft.description ?? "").trim() || draft.title || "Listing from Glean.";
        const unit = (draft.unit ?? "kg") as "kg" | "lb" | "count" | "bunch";
        const body = {
          type: "supply" as const,
          title: draft.title.trim(),
          item: draft.item.trim(),
          description,
          price: draft.pricePerKg,
          qty: draft.weightKg,
          unit,
          latLng: [0, 0] as [number, number],
          ...(draft.imageId && { photos: [{ imageId: draft.imageId }] }),
          ...(draft.deliveryWindow?.startAt &&
            draft.deliveryWindow?.endAt && {
              deliveryWindow: {
                startAt: draft.deliveryWindow.startAt,
                endAt: draft.deliveryWindow.endAt,
              },
            }),
        };
        const created = (await createListing(body)) as { _id: string };
        setPostError(null);
        return {
          listingId: created._id,
          title: draft.title.trim(),
          item: draft.item.trim(),
          priceLine: `$${draft.pricePerKg.toFixed(2)} per ${unit} · ${draft.weightKg} ${unit}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to post listing.";
        console.error("Failed to post listing:", message);
        setPostError(message);
        return undefined;
      }
    },
    [createListing]
  );

  const handleCreateChat = useCallback(async () => {
    await createChat();
  }, [createChat]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] max-h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Sidebar */}
      <GleanChatSidebar
        chats={chats}
        activeChatId={activeChatId}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        onSelectChat={setActiveChatId}
        onCreateChat={handleCreateChat}
        onRenameChat={renameChat}
        onDeleteChat={deleteChat}
      />

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="max-w-5xl w-full mx-auto px-2 sm:px-3 md:px-5 lg:px-6 py-4 sm:py-6 flex flex-col flex-1 min-h-0">
          <div className="shrink-0">
            <h1 className="text-2xl font-semibold text-zinc-900 mb-1">Glean</h1>
            <p className="text-zinc-500 text-sm mb-4">
              Your agriculture personal assistant.
            </p>
          </div>
          {chatLoadError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 shrink-0">
              {chatLoadError}
            </div>
          )}
          {postError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 shrink-0">
              Failed to post listing: {postError}
            </div>
          )}
          <div className="flex-1 min-h-0">
            {noChats ? (
              <div className="flex flex-col h-full items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50/50">
                <div className="flex flex-col items-center gap-4 text-center px-6">
                  <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-zinc-100 text-zinc-400">
                    <MessageSquarePlus className="w-7 h-7" />
                  </div>
                  <div>
                    <p className="text-base font-medium text-zinc-900">
                      No conversations yet
                    </p>
                    <p className="mt-1 text-sm text-zinc-500 max-w-[280px]">
                      {role === "farmer"
                        ? "Start a chat to draft listings from your harvest."
                        : "Start a chat to find and source local produce."}
                    </p>
                  </div>
                  <Button onClick={handleCreateChat} className="gap-2">
                    <MessageSquarePlus className="w-4 h-4" />
                    New chat
                  </Button>
                </div>
              </div>
            ) : (
              <ChatInterface
                role={role}
                chatId={activeChatId}
                onPostInventory={handlePostInventory}
                onClearPostError={() => setPostError(null)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
