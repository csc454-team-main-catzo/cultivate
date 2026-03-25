import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Send } from "lucide-react";
import type { InventoryDraftData } from "../types";
import CFG from "@/config";
import GhostTextarea from "@/components/GhostTextarea";
import { getListingDescriptionSuggestion } from "@/utils/suggestions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface InventoryDraftCardProps {
  draft: InventoryDraftData;
  /** Assistant message id — re-hydrate title/description/weights only when a new draft card appears (keeps CV/AI-filled text stable while typing). */
  draftMessageId: string;
  onPost: (draft: InventoryDraftData) => void;
  primaryButtonClass?: string;
}

export function InventoryDraftCard({
  draft,
  draftMessageId,
  onPost,
  primaryButtonClass = "bg-zinc-900 hover:bg-zinc-800 text-white",
}: InventoryDraftCardProps) {
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description ?? "");
  const [weight, setWeight] = useState(String(draft.weightKg));
  const [price, setPrice] = useState(String(draft.pricePerKg));

  useEffect(() => {
    setTitle(draft.title);
    setDescription(draft.description ?? "");
    setWeight(String(draft.weightKg));
    setPrice(String(draft.pricePerKg));
    // Re-hydrate only when the assistant sends a new inventory card, not when `draft` is re-created each render.
  }, [draftMessageId]); // eslint-disable-line react-hooks/exhaustive-deps -- draft fields read once per new message id

  const getDescriptionSuggestion = useCallback(
    (text: string) =>
      getListingDescriptionSuggestion(text, {
        itemName: draft.item,
        qty: weight,
        unit: draft.unit ?? "kg",
        price,
        priceUnit: draft.unit ?? "kg",
      }),
    [draft.item, draft.unit, weight, price]
  );

  const weightNum = Number(weight) || 0;
  const priceNum = Number(price) || 0;
  const titleTrimmed = title.trim();
  const descTrimmed = description.trim();
  const isValid =
    titleTrimmed.length > 0 &&
    descTrimmed.length > 0 &&
    weightNum > 0 &&
    priceNum > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    onPost({
      ...draft,
      title: titleTrimmed.slice(0, 150),
      description: descTrimmed.slice(0, 2000),
      weightKg: weightNum,
      pricePerKg: priceNum,
    });
  }

  const hasPhoto = Boolean(draft.imageId);
  const hasDeliveryWindow = Boolean(draft.deliveryWindow?.startAt && draft.deliveryWindow?.endAt);
  const isImageOnlyPrompt = hasPhoto && !hasDeliveryWindow;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card>
        <CardContent className="p-5">
          {!hasPhoto && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
              Add a photo to your listing for better visibility. Use the attachment button in the chat, then describe your produce again.
            </p>
          )}
          {isImageOnlyPrompt && (
            <p className="text-sm text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 mb-3">
              Fill in title, description, weight, and price below (or say them in chat for next time), then tap Post.
            </p>
          )}
          {hasPhoto && draft.imageId && (
            <img
              src={`${CFG.API_URL}/api/images/${draft.imageId}`}
              alt=""
              className="w-full max-h-48 object-cover rounded-lg border border-zinc-200 mb-3"
            />
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-zinc-500">
                Title <span className="text-red-500">*</span>
              </span>
              <Input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={150}
                placeholder="Listing title"
              />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-xs font-medium text-zinc-500">
                Description <span className="text-red-500">*</span>
              </span>
              <GhostTextarea
                value={description}
                onChange={(v) => setDescription(v)}
                getSuggestion={getDescriptionSuggestion}
                placeholder="Describe what you're offering — variety, quality, pickup, etc."
                rows={3}
                maxLength={2000}
              />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="space-y-1.5 block">
                <span className="text-xs font-medium text-zinc-500">
                  Weight ({draft.unit ?? "kg"})
                </span>
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                />
              </label>
              <label className="space-y-1.5 block">
                <span className="text-xs font-medium text-zinc-500">
                  Price per {draft.unit ?? "kg"} ($)
                </span>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
            </div>
            <Button
              type="submit"
              disabled={!isValid}
              className={cn("w-full gap-2", primaryButtonClass)}
            >
              <Send className="h-4 w-4" />
              Post to listings
            </Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
