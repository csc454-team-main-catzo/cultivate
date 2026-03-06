import { motion } from "framer-motion";
import { ShoppingCart } from "lucide-react";
import type { ProductGridItem } from "../types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ProductCardProps {
  item: ProductGridItem;
  onAddToOrder?: (item: ProductGridItem) => void;
  onNegotiate?: (item: ProductGridItem) => void;
  primaryButtonClass?: string;
}

export function ProductCard({
  item,
  onAddToOrder,
  onNegotiate,
  primaryButtonClass = "bg-zinc-900 hover:bg-zinc-800 text-white",
}: ProductCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card className="overflow-hidden hover:shadow-md transition-shadow">
        <div className="aspect-[4/3] bg-zinc-100 flex items-center justify-center">
          <span className="text-4xl opacity-60">🥕</span>
        </div>
        <CardContent className="p-4">
          <h3 className="font-medium text-zinc-900 text-sm leading-tight line-clamp-2 mb-1">
            {item.title}
          </h3>
          <p className="text-xs text-zinc-500 mb-2">{item.farmerName}</p>
          {item.description && (
            <p className="text-xs text-zinc-600 line-clamp-2 mb-2">
              {item.description}
            </p>
          )}
          <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
            <span className="text-sm font-semibold text-zinc-900">
              ${item.price.toFixed(2)}
              <span className="font-normal text-zinc-500 text-xs ml-0.5">
                /{item.unit ?? "kg"}
              </span>
            </span>
            <div className="flex gap-1.5">
              {onNegotiate && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onNegotiate(item)}
                  className="text-xs h-8"
                >
                  Negotiate
                </Button>
              )}
              {onAddToOrder && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onAddToOrder(item)}
                  className={cn("text-xs h-8 gap-1", primaryButtonClass)}
                >
                  <ShoppingCart className="h-3.5 w-3.5" />
                  Add to Order
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
