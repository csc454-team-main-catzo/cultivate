import { useNavigate } from "react-router-dom";
import { useUser } from "../providers/userContext";
import { useListingActions } from "../hooks/useListingActions";
import { ChatInterface } from "../features/agent-sourcing/components/chat-interface";
import { getUserRole } from "../lib/auth";
import type { InventoryDraftData } from "../features/agent-sourcing/types";
import type { ProductGridItem } from "../features/agent-sourcing/types";

export default function AgentSourcing() {
  const { user } = useUser();
  const { createListing } = useListingActions();
  const navigate = useNavigate();
  const role = getUserRole(user ?? null) ?? "farmer";

  async function handlePostInventory(draft: InventoryDraftData) {
    try {
      const body = {
        type: "supply" as const,
        title: draft.title,
        item: draft.item,
        description: draft.description ?? "",
        price: draft.pricePerKg,
        qty: draft.weightKg,
        unit: draft.unit ?? "kg",
        latLng: [0, 0] as [number, number],
      };
      const created = await createListing(body);
      const id = (created as { _id?: string })._id;
      if (id) navigate(`/listings/${id}`);
      else navigate("/listings");
    } catch (err) {
      console.error("Failed to post listing:", err);
    }
  }

  function handleAddToOrder(item: ProductGridItem) {
    navigate(`/listings/${item.listingId}`);
  }

  function handleNegotiate(item: ProductGridItem) {
    navigate(`/listings/${item.listingId}`);
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-semibold text-zinc-900 mb-2">Glean</h1>
      <p className="text-zinc-500 text-sm mb-6">
        Your agriculture personal assistant.
      </p>
      <div className="min-h-[520px]">
        <ChatInterface
          role={role}
          onPostInventory={handlePostInventory}
          onAddToOrder={handleAddToOrder}
          onNegotiate={handleNegotiate}
        />
      </div>
    </div>
  );
}
