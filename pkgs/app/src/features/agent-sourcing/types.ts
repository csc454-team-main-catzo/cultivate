/**
 * Agent sourcing message and payload types.
 * Messages can be plain text, a product grid (restaurant), or an inventory draft form (farmer).
 */

export type MessageRole = "user" | "assistant";

export type MessageContentType = "text" | "product_grid" | "inventory_form" | "strategy_options";

export interface AgentMessageBase {
  id: string;
  role: MessageRole;
  type: MessageContentType;
  createdAt: Date;
}

export interface TextMessage extends AgentMessageBase {
  type: "text";
  content: string;
  /** When true, content is still streaming (simulated). */
  isStreaming?: boolean;
  /** User message: id of image uploaded via chat attachment. */
  imageId?: string;
}

export interface ProductGridItem {
  id: string;
  listingId: string;
  title: string;
  item: string;
  description?: string;
  price: number;
  qty: number;
  unit?: string;
  farmerName: string;
  farmerId: string;
  /** From API: listing photo id; frontend can resolve to imageUrl. */
  imageId?: string;
  imageUrl?: string;
  /** "exact" | "substitute" etc. from the sourcing optimizer allocation. */
  matchType?: string;
  /** 0–1 score indicating how well this product matches the requested item. */
  matchScore?: number;
}

export interface ProductGridMessage extends AgentMessageBase {
  type: "product_grid";
  query: string;
  items: ProductGridItem[];
  /** Passed from the sourcing plan so the product grid can show a warning banner. */
  unfulfillable?: SourcingPlanData["unfulfillable"];
}

export interface InventoryDraftData {
  title: string;
  item: string;
  description?: string;
  weightKg: number;
  pricePerKg: number;
  unit?: "kg" | "lb" | "count" | "bunch";
  /** When set, attach this image when posting (from chat upload). */
  imageId?: string;
}

/** Returned after posting a listing from a Glean draft; used to append the persisted green confirmation message. */
export interface ListingPostSuccessInfo {
  listingId: string;
  title: string;
  item: string;
  priceLine: string;
}

export interface InventoryFormMessage extends AgentMessageBase {
  type: "inventory_form";
  draft: InventoryDraftData;
  /** Raw user message that led to this draft */
  userMessage?: string;
}

/* ------------------------------------------------------------------ */
/*  Strategy options (sourcing optimizer output)                       */
/* ------------------------------------------------------------------ */

export interface StrategyMetricsSummary {
  totalCost: number;
  supplierCount: number;
  coveragePercent: number;
  avgMatchScore: number;
  estimatedDelivery?: string;
}

export interface StrategyOptionItem {
  strategyId: string;
  name: string;
  description: string;
  rank: number;
  metrics: StrategyMetricsSummary;
  tradeoffs: string[];
}

export interface StrategyAllocation {
  lineItemIndex: number;
  lineItemName: string;
  supplier: {
    listingId: string;
    supplierId: string;
    supplierName: string;
    item: string;
    title: string;
    pricePerUnit: number;
    imageId?: string;
  };
  allocatedQty: number;
  unit: string;
  subtotal: number;
  matchType: string;
  matchScore: number;
}

export interface SourcingPlanData {
  orderId: string;
  strategies: Array<{
    id: string;
    name: string;
    allocations: StrategyAllocation[];
  }>;
  unfulfillable: Array<{
    lineItemName: string;
    qtyNeeded: number;
    qtyAvailable: number;
    reason: string;
  }>;
  summary: string;
  reasoning: string;
}

export interface StrategyOptionsMessage extends AgentMessageBase {
  type: "strategy_options";
  options: StrategyOptionItem[];
  recommendedStrategyId: string | null;
  sourcingPlan: SourcingPlanData;
}

export type AgentMessage =
  | TextMessage
  | ProductGridMessage
  | InventoryFormMessage
  | StrategyOptionsMessage;

export type UserRole = "farmer" | "restaurant" | "admin";
