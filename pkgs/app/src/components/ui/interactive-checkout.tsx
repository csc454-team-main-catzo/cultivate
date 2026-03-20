import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, CreditCard, Minus, Plus, ShoppingCart, X } from "lucide-react";
import NumberFlow from "@number-flow/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Unit types & conversion                                           */
/* ------------------------------------------------------------------ */

export type WeightUnit = "kg" | "lb";
export type DiscreteUnit = "count" | "bunch";
export type ProductUnit = WeightUnit | DiscreteUnit;

const WEIGHT_UNITS: ReadonlySet<string> = new Set<WeightUnit>(["kg", "lb"]);

const KG_PER_LB = 0.453592;

/** Conversion factors to a canonical base (kg for weight). */
const TO_KG: Record<WeightUnit, number> = { kg: 1, lb: KG_PER_LB };

function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return value;
  return (value * TO_KG[from]) / TO_KG[to];
}

function convertPrice(pricePerUnit: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return pricePerUnit;
  return pricePerUnit * (TO_KG[to] / TO_KG[from]);
}

function isWeightUnit(u: string): u is WeightUnit {
  return WEIGHT_UNITS.has(u);
}

/** Return the set of units the restaurant can choose for a given listing unit. */
function alternateUnits(listingUnit: ProductUnit): ProductUnit[] {
  if (isWeightUnit(listingUnit)) return ["kg", "lb"];
  return [listingUnit];
}

const UNIT_LABELS: Record<ProductUnit, string> = {
  kg: "kg",
  lb: "lb",
  count: "ct",
  bunch: "bunch",
};

/* ------------------------------------------------------------------ */
/*  Product / Cart types                                              */
/* ------------------------------------------------------------------ */

export interface Product {
  id: string;
  /** ID of the backing listing (used for detail links). */
  listingId?: string;
  name: string;
  /** Price per listing unit. */
  price: number;
  category: string;
  image: string;
  color: string;
  /** The unit the listing is sold in (default "kg"). */
  unit?: ProductUnit;
  /** Available quantity in listing units. */
  availableQty?: number;
  /** Pre-fill quantity parsed from the user's chat message. */
  requestedQty?: number;
  /** Pre-fill unit parsed from the user's chat message. */
  requestedUnit?: ProductUnit;
  /** Optional delivery/availability window for listing. */
  deliveryWindow?: { startAt: string; endAt: string };
}

export interface CartItem extends Product {
  /** Quantity always stored in listing (native) units. */
  quantity: number;
}

interface InteractiveCheckoutProps {
  products?: Product[];
  cart?: CartItem[];
  onCartChange?: (cart: CartItem[]) => void;
  onCheckout?: (params: { cart: CartItem[]; total: number }) => void;
  /** When set, quantity inputs and unit selections are persisted to sessionStorage. */
  storageKey?: string;
}

const defaultProducts: Product[] = [
  {
    id: "1",
    name: "Heirloom Tomatoes",
    price: 4.9,
    category: "Fresh produce",
    image:
      "https://images.unsplash.com/photo-1567306226416-28f0efdc88ce?auto=format&fit=crop&w=600&q=80",
    color: "Red / mixed sizes",
    unit: "kg",
  },
  {
    id: "2",
    name: "Seasonal Greens Mix",
    price: 6.25,
    category: "Leafy greens",
    image:
      "https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=600&q=80",
    color: "Green / assorted",
    unit: "lb",
  },
  {
    id: "3",
    name: "Free-range Eggs",
    price: 14.0,
    category: "Dairy & eggs",
    image:
      "https://images.unsplash.com/photo-1517959105821-eaf2591984c2?auto=format&fit=crop&w=600&q=80",
    color: "Brown shell",
    unit: "count",
  },
];

/* ------------------------------------------------------------------ */
/*  Sub-components: price line & unit picker                          */
/* ------------------------------------------------------------------ */

function ProductPriceLine({ product, selectedUnit }: { product: Product; selectedUnit: ProductUnit }) {
  const listingUnit = product.unit ?? "kg";
  const needsConversion = isWeightUnit(listingUnit) && isWeightUnit(selectedUnit) && selectedUnit !== listingUnit;
  const displayPrice = needsConversion
    ? convertPrice(product.price, listingUnit as WeightUnit, selectedUnit as WeightUnit)
    : product.price;
  const displayUnit = needsConversion ? selectedUnit : listingUnit;

  return (
    <span>
      ${displayPrice.toFixed(2)}/{UNIT_LABELS[displayUnit]}
      {product.color ? ` • ${product.color}` : ""}
    </span>
  );
}

function UnitPicker({
  listingUnit,
  value,
  onChange,
}: {
  listingUnit: ProductUnit;
  value: ProductUnit;
  onChange: (u: ProductUnit) => void;
}) {
  const options = alternateUnits(listingUnit);
  if (options.length <= 1) return null;

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ProductUnit)}
        className={cn(
          "appearance-none h-8 pl-2 pr-6 text-sm rounded-md",
          "border border-zinc-200 bg-white",
          "focus:outline-none focus:ring-2 focus:ring-zinc-400",
          "cursor-pointer transition-colors duration-150",
        )}
      >
        {options.map((u) => (
          <option key={u} value={u}>{UNIT_LABELS[u]}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

function InteractiveCheckout({
  products = defaultProducts,
  cart: controlledCart,
  onCartChange,
  onCheckout,
  storageKey,
}: InteractiveCheckoutProps) {
  const [internalCart, setInternalCart] = useState<CartItem[]>([]);

  const [quantities, setQuantities] = useState<Record<string, string>>(() => {
    if (storageKey) {
      try {
        const saved = sessionStorage.getItem(`${storageKey}:qty`);
        if (saved) return JSON.parse(saved) as Record<string, string>;
      } catch { /* ignore */ }
    }
    const init: Record<string, string> = {};
    for (const p of products) {
      if (p.requestedQty != null && p.requestedQty > 0) {
        let qty = p.requestedQty;
        if (p.availableQty != null) {
          const listingUnit = p.unit ?? "kg";
          const reqUnit = p.requestedUnit ?? listingUnit;
          const availInReqUnit =
            isWeightUnit(listingUnit) && isWeightUnit(reqUnit) && reqUnit !== listingUnit
              ? convertWeight(p.availableQty, listingUnit, reqUnit)
              : p.availableQty;
          qty = Math.min(qty, Math.round(availInReqUnit * 100) / 100);
        }
        init[p.id] = String(qty);
      }
    }
    return init;
  });

  const [selectedUnits, setSelectedUnits] = useState<Record<string, ProductUnit>>(() => {
    if (storageKey) {
      try {
        const saved = sessionStorage.getItem(`${storageKey}:units`);
        if (saved) return JSON.parse(saved) as Record<string, ProductUnit>;
      } catch { /* ignore */ }
    }
    const init: Record<string, ProductUnit> = {};
    for (const p of products) {
      if (p.requestedUnit) init[p.id] = p.requestedUnit;
    }
    return init;
  });

  // Persist quantities & units to sessionStorage on change (including first render
  // so auto-fill values from requestedQty/requestedUnit are saved immediately).
  useEffect(() => {
    if (!storageKey) return;
    try {
      sessionStorage.setItem(`${storageKey}:qty`, JSON.stringify(quantities));
      sessionStorage.setItem(`${storageKey}:units`, JSON.stringify(selectedUnits));
    } catch { /* quota */ }
  }, [storageKey, quantities, selectedUnits]);
  const cart = controlledCart ?? internalCart;

  /** How much of this product is already in the cart (in listing units). */
  const inCartNative = useCallback(
    (productId: string) => cart.find((c) => c.id === productId)?.quantity ?? 0,
    [cart],
  );

  /**
   * Remaining stock for a product expressed in a given display unit.
   * Returns `undefined` when the listing has no cap.
   */
  const remainingInUnit = useCallback(
    (product: Product, displayUnit: ProductUnit): number | undefined => {
      if (product.availableQty == null) return undefined;
      const listingUnit = product.unit ?? "kg";
      const leftNative = product.availableQty - inCartNative(product.id);
      if (isWeightUnit(listingUnit) && isWeightUnit(displayUnit) && displayUnit !== listingUnit) {
        return Math.round(convertWeight(leftNative, listingUnit, displayUnit) * 100) / 100;
      }
      return Math.round(leftNative * 100) / 100;
    },
    [inCartNative],
  );

  const getQtyStr = (productId: string) => quantities[productId] ?? "1";
  const getQtyNum = (productId: string) => {
    const n = parseFloat(quantities[productId] ?? "1");
    return Number.isFinite(n) && n > 0 ? n : 1;
  };

  const setQtyStr = (productId: string, raw: string) => {
    setQuantities((prev) => ({ ...prev, [productId]: raw }));
  };

  const getSelectedUnit = (product: Product): ProductUnit =>
    selectedUnits[product.id] ?? product.unit ?? "kg";

  const setSelectedUnit = (productId: string, unit: ProductUnit) => {
    setSelectedUnits((prev) => ({ ...prev, [productId]: unit }));
  };

  const setCart = useCallback(
    (next: CartItem[] | ((current: CartItem[]) => CartItem[])) => {
      const computed =
        typeof next === "function" ? (next as (c: CartItem[]) => CartItem[])(cart) : next;
      if (onCartChange) onCartChange(computed);
      else setInternalCart(computed);
    },
    [cart, onCartChange]
  );

  /**
   * Add to cart — converts the restaurant's input quantity back to the
   * listing's native unit so the cart is always in listing units.
   */
  const addToCart = (product: Product, inputQty: number, inputUnit: ProductUnit) => {
    const listingUnit = product.unit ?? "kg";
    let nativeQty = inputQty;
    if (isWeightUnit(inputUnit) && isWeightUnit(listingUnit) && inputUnit !== listingUnit) {
      nativeQty = convertWeight(inputQty, inputUnit, listingUnit);
    }
    nativeQty = Math.round(nativeQty * 100) / 100;

    setCart((currentCart) => {
      const existing = currentCart.find((item) => item.id === product.id);
      const alreadyInCart = existing?.quantity ?? 0;

      if (product.availableQty != null) {
        const maxAddable = Math.max(0, product.availableQty - alreadyInCart);
        nativeQty = Math.min(nativeQty, maxAddable);
      }
      if (nativeQty <= 0) return currentCart;

      if (existing) {
        return currentCart.map((item) =>
          item.id === product.id
            ? { ...item, quantity: Math.round((item.quantity + nativeQty) * 100) / 100 }
            : item,
        );
      }
      return [...currentCart, { ...product, quantity: nativeQty }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart((currentCart) =>
      currentCart.filter((item) => item.id !== productId),
    );
  };

  const updateQuantity = (productId: string, delta: number) => {
    const product = products.find((p) => p.id === productId);
    setCart((currentCart) =>
      currentCart.map((item) => {
        if (item.id === productId) {
          let newQuantity = item.quantity + delta;
          if (newQuantity <= 0) return item;
          if (product?.availableQty != null) {
            newQuantity = Math.min(newQuantity, product.availableQty);
          }
          return { ...item, quantity: Math.round(newQuantity * 100) / 100 };
        }
        return item;
      }),
    );
  };

  const totalPrice = useMemo(
    () => Math.round(cart.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100,
    [cart]
  );

  const handleMockCheckout = () => {
    if (cart.length === 0) {
      window.alert("Your cart is empty. Add some items before checking out.");
      return;
    }
    if (onCheckout) {
      onCheckout({ cart, total: totalPrice });
      return;
    }
    window.alert(
      "This is a mock checkout flow.\n\nIn a real deployment, this would hand off to a payment provider or purchase order workflow. No real payment is processed.",
    );
  };

  return (
    <div className="w-full">
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 space-y-3">
          {products.map((product) => (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "group",
                "p-3 sm:p-4 rounded-xl",
                "bg-white",
                "border border-zinc-200",
                "hover:border-zinc-300",
                "transition-all duration-200",
              )}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                {(() => {
                  const info = (
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          "relative w-12 h-12 rounded-lg overflow-hidden shrink-0",
                          "bg-zinc-100",
                          "transition-colors duration-200",
                          "group-hover:bg-zinc-200",
                        )}
                      >
                        <img
                          src={product.image}
                          alt={product.name}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                          <h3 className="text-sm font-medium text-zinc-900 truncate">
                            {product.name}
                          </h3>
                          <span className="px-2 py-0.5 text-xs rounded-full bg-zinc-100 text-zinc-500 shrink-0">
                            {product.category}
                          </span>
                        </div>
                        <div className="flex flex-col gap-0.5 text-sm text-zinc-500">
                          <ProductPriceLine product={product} selectedUnit={getSelectedUnit(product)} />
                          {product.deliveryWindow?.startAt && product.deliveryWindow?.endAt && (
                            <span className="text-xs text-zinc-500">
                              Delivery:{" "}
                              {new Date(product.deliveryWindow.startAt).toLocaleString(undefined, {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}{" "}
                              –{" "}
                              {new Date(product.deliveryWindow.endAt).toLocaleString(undefined, {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                  return product.listingId ? (
                    <Link
                      to={`/listings/${product.listingId}`}
                      state={{ from: "chat" }}
                      className="min-w-0 hover:opacity-80 transition-opacity"
                    >
                      {info}
                    </Link>
                  ) : info;
                })()}
                {(() => {
                  const selUnit = getSelectedUnit(product);
                  const remaining = remainingInUnit(product, selUnit);
                  const soldOut = remaining != null && remaining <= 0;
                  const inputQty = getQtyNum(product.id);
                  const exceeds = remaining != null && inputQty > remaining;
                  const cannotAdd = soldOut || exceeds;
                  return (
                    <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0.01}
                          step={isWeightUnit(selUnit) ? 0.1 : 1}
                          max={remaining ?? undefined}
                          value={getQtyStr(product.id)}
                          disabled={soldOut}
                          onChange={(e) => setQtyStr(product.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !cannotAdd) {
                              addToCart(product, inputQty, selUnit);
                              setQtyStr(product.id, "1");
                            }
                          }}
                          className={cn(
                            "w-16 h-8 text-center text-sm rounded-md",
                            "border bg-white",
                            "focus:outline-none focus:ring-2",
                            "transition-colors duration-150",
                            exceeds
                              ? "border-red-400 focus:ring-red-300"
                              : "border-zinc-200 focus:ring-zinc-400",
                            soldOut && "opacity-50 cursor-not-allowed",
                          )}
                        />
                        <UnitPicker
                          listingUnit={product.unit ?? "kg"}
                          value={selUnit}
                          onChange={(u) => setSelectedUnit(product.id, u)}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={cannotAdd}
                          onClick={() => {
                            addToCart(product, inputQty, selUnit);
                            setQtyStr(product.id, "1");
                          }}
                          className="gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add
                        </Button>
                      </div>
                      {remaining != null && (
                        <span className={cn(
                          "text-xs",
                          exceeds || soldOut ? "text-red-500" : "text-zinc-400",
                        )}>
                          {soldOut
                            ? "All in cart"
                            : exceeds
                              ? `Exceeds available (${remaining} ${UNIT_LABELS[selUnit]})`
                              : `${remaining} ${UNIT_LABELS[selUnit]} available`}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className={cn(
            "w-full lg:w-80 flex flex-col",
            "p-3 sm:p-4 rounded-xl",
            "bg-white",
            "border border-zinc-200",
            "lg:sticky lg:top-4",
            "max-h-[32rem]",
          )}
        >
          <div className="flex items-center gap-2 mb-3">
            <ShoppingCart className="w-4 h-4 text-zinc-500" />
            <h2 className="text-sm font-medium text-zinc-900">
              Cart
            </h2>
          </div>

          <motion.div
            className={cn(
              "flex-1 overflow-y-auto",
              "min-h-0",
              "-mx-4 px-4",
              "space-y-3",
            )}
          >
            <AnimatePresence initial={false} mode="popLayout">
              {cart.map((item) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{
                    opacity: { duration: 0.2 },
                    layout: { duration: 0.2 },
                  }}
                  className={cn(
                    "flex items-center gap-3",
                    "p-2 rounded-lg",
                    "bg-zinc-50",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-zinc-900 truncate">
                        {item.name}
                      </span>
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => removeFromCart(item.id)}
                        className="p-1 rounded-md hover:bg-zinc-200"
                      >
                        <X className="w-3 h-3 text-zinc-400" />
                      </motion.button>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <div className="flex items-center gap-1">
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => updateQuantity(item.id, -1)}
                          className="p-1 rounded-md hover:bg-zinc-200"
                        >
                          <Minus className="w-3 h-3" />
                        </motion.button>
                        <motion.span
                          layout
                          className="text-xs text-zinc-600 min-w-[2rem] text-center"
                        >
                          {item.quantity}{" "}{UNIT_LABELS[item.unit ?? "kg"]}
                        </motion.span>
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => updateQuantity(item.id, 1)}
                          className="p-1 rounded-md hover:bg-zinc-200"
                        >
                          <Plus className="w-3 h-3" />
                        </motion.button>
                      </div>
                      <motion.span
                        layout
                        className="text-xs text-zinc-500"
                      >
                        ${(item.price * item.quantity).toFixed(2)}
                      </motion.span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>

          <motion.div
            layout
            className={cn(
              "pt-3 mt-3",
              "border-t border-zinc-200",
              "bg-white",
            )}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-zinc-900">Total</span>
              <motion.span
                layout
                className="text-sm font-semibold text-zinc-900"
              >
                <NumberFlow value={Number(totalPrice.toFixed(2))} />
              </motion.span>
            </div>
            <Button
              size="sm"
              className="w-full gap-2"
              type="button"
              onClick={handleMockCheckout}
            >
              <CreditCard className="w-4 h-4" />
              Checkout
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}

export { InteractiveCheckout };

