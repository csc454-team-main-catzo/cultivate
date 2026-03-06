import { useState } from "react";
import { motion } from "framer-motion";
import { Send } from "lucide-react";
import type { InventoryDraftData } from "../types";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface InventoryDraftCardProps {
  draft: InventoryDraftData;
  onPost: (draft: InventoryDraftData) => void;
  primaryButtonClass?: string;
}

export function InventoryDraftCard({
  draft,
  onPost,
  primaryButtonClass = "bg-zinc-900 hover:bg-zinc-800 text-white",
}: InventoryDraftCardProps) {
  const [weight, setWeight] = useState(String(draft.weightKg));
  const [price, setPrice] = useState(String(draft.pricePerKg));

  const weightNum = Number(weight) || 0;
  const priceNum = Number(price) || 0;
  const isValid = weightNum > 0 && priceNum > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    onPost({
      ...draft,
      weightKg: weightNum,
      pricePerKg: priceNum,
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card>
        <CardContent className="p-5">
          <h3 className="font-semibold text-zinc-900 text-base mb-1">
            {draft.title}
          </h3>
          {draft.description && (
            <p className="text-sm text-zinc-500 line-clamp-2 mb-4">
              {draft.description}
            </p>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
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
