import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "../providers/userContext";
import { useListingActions } from "../hooks/useListingActions";
import { ChatInterface } from "../features/agent-sourcing/components/chat-interface";
import { GleanChatSidebar } from "../features/agent-sourcing/components/GleanChatSidebar";
import { useGleanChats } from "../features/agent-sourcing/hooks/useGleanChats";
import { getUserRole } from "../lib/auth";
import type { InventoryDraftData } from "../features/agent-sourcing/types";

export default function AgentSourcing() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { createListing } = useListingActions();
  const role = getUserRole(user ?? null) ?? "farmer";

  const {
    chats,
    activeChatId,
    error: chatLoadError,
    setActiveChatId,
    createChat,
    renameChat,
    deleteChat,
  } = useGleanChats(role);

  const [postError, setPostError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handlePostInventory = useCallback(
    async (draft: InventoryDraftData) => {
      try {
        const description = (draft.description ?? "").trim() || draft.title || "Listing from Glean.";
        const body = {
          type: "supply" as const,
          title: draft.title.trim(),
          item: draft.item.trim(),
          description,
          price: draft.pricePerKg,
          qty: draft.weightKg,
          unit: (draft.unit ?? "kg") as "kg" | "lb" | "count" | "bunch",
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
        navigate(`/listings/${created._id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to post listing.";
        console.error("Failed to post listing:", message);
        setPostError(message);
      }
    },
    [createListing, navigate]
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
            <ChatInterface
              role={role}
              chatId={activeChatId}
              onPostInventory={handlePostInventory}
              onClearPostError={() => setPostError(null)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
