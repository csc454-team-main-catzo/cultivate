import mongoose, { Schema, Document, Types } from "mongoose";

export type GleanMessageRole = "user" | "assistant";
export type GleanMessageType = "text" | "product_grid" | "inventory_form" | "strategy_options";

export interface IGleanProductGridItem {
  id: string;
  listingId?: string;
  title: string;
  item: string;
  description?: string;
  price: number;
  qty: number;
  unit?: string;
  farmerName: string;
  farmerId: string;
  imageUrl?: string;
}

export interface IGleanInventoryDraftData {
  title: string;
  item: string;
  description?: string;
  weightKg: number;
  pricePerKg: number;
  unit?: "kg" | "lb" | "count" | "bunch";
}

export interface IGleanStrategyMetrics {
  totalCost: number;
  supplierCount: number;
  coveragePercent: number;
  avgMatchScore: number;
  estimatedDelivery?: string;
}

export interface IGleanStrategyOption {
  strategyId: string;
  name: string;
  description: string;
  rank: number;
  metrics: IGleanStrategyMetrics;
  tradeoffs: string[];
}

export interface IGleanStrategyAllocation {
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
  deliveryWindow?: { startAt: string; endAt: string };
}

export interface IGleanSourcingPlan {
  orderId: string;
  strategies: Array<{
    id: string;
    name: string;
    allocations: IGleanStrategyAllocation[];
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

export interface IGleanChatMessage {
  _id: Types.ObjectId;
  role: GleanMessageRole;
  type: GleanMessageType;
  content?: string;
  items?: IGleanProductGridItem[];
  draft?: IGleanInventoryDraftData;
  options?: IGleanStrategyOption[];
  recommendedStrategyId?: string | null;
  sourcingPlan?: IGleanSourcingPlan;
  createdAt: Date;
}

export interface IGleanChat extends Document {
  user: Types.ObjectId;
  role: "farmer" | "restaurant";
  title: string;
  messages: IGleanChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const GleanProductGridItemSchema = new Schema<IGleanProductGridItem>(
  {
    id: { type: String, required: true },
    listingId: { type: String, required: false },
    title: { type: String, required: true },
    item: { type: String, required: true },
    description: { type: String, required: false },
    price: { type: Number, required: true },
    qty: { type: Number, required: true },
    unit: { type: String, required: false },
    farmerName: { type: String, required: true },
    farmerId: { type: String, required: true },
    imageUrl: { type: String, required: false },
  },
  { _id: false }
);

const GleanInventoryDraftSchema = new Schema<IGleanInventoryDraftData>(
  {
    title: { type: String, required: true },
    item: { type: String, required: true },
    description: { type: String, required: false },
    weightKg: { type: Number, required: true },
    pricePerKg: { type: Number, required: true },
    unit: { type: String, required: false },
  },
  { _id: false }
);

const GleanStrategyMetricsSchema = new Schema<IGleanStrategyMetrics>(
  {
    totalCost: { type: Number, required: true },
    supplierCount: { type: Number, required: true },
    coveragePercent: { type: Number, required: true },
    avgMatchScore: { type: Number, required: true },
    estimatedDelivery: { type: String, required: false },
  },
  { _id: false }
);

const GleanStrategyOptionSchema = new Schema<IGleanStrategyOption>(
  {
    strategyId: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, required: true },
    rank: { type: Number, required: true },
    metrics: { type: GleanStrategyMetricsSchema, required: true },
    tradeoffs: { type: [String], default: [] },
  },
  { _id: false }
);

const GleanStrategyAllocationSchema = new Schema<IGleanStrategyAllocation>(
  {
    lineItemIndex: { type: Number, required: true },
    lineItemName: { type: String, required: true },
    supplier: {
      type: new Schema(
        {
          listingId: { type: String, required: true },
          supplierId: { type: String, required: true },
          supplierName: { type: String, required: true },
          item: { type: String, required: true },
          title: { type: String, required: true },
          pricePerUnit: { type: Number, required: true },
          imageId: { type: String, required: false },
        },
        { _id: false }
      ),
      required: true,
    },
    allocatedQty: { type: Number, required: true },
    unit: { type: String, required: true },
    subtotal: { type: Number, required: true },
    matchType: { type: String, required: true },
    matchScore: { type: Number, required: true },
    deliveryWindow: {
      type: new Schema(
        {
          startAt: { type: String, required: true },
          endAt: { type: String, required: true },
        },
        { _id: false }
      ),
      required: false,
    },
  },
  { _id: false }
);

const GleanSourcingPlanSchema = new Schema<IGleanSourcingPlan>(
  {
    orderId: { type: String, required: true },
    strategies: {
      type: [
        new Schema(
          {
            id: { type: String, required: true },
            name: { type: String, required: true },
            allocations: { type: [GleanStrategyAllocationSchema], default: [] },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    unfulfillable: {
      type: [
        new Schema(
          {
            lineItemName: { type: String, required: true },
            qtyNeeded: { type: Number, required: true },
            qtyAvailable: { type: Number, required: true },
            reason: { type: String, required: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    summary: { type: String, required: true },
    reasoning: { type: String, required: true },
  },
  { _id: false }
);

const GleanChatMessageSchema = new Schema<IGleanChatMessage>(
  {
    role: { type: String, required: true, enum: ["user", "assistant"] },
    type: {
      type: String,
      required: true,
      enum: ["text", "product_grid", "inventory_form", "strategy_options"],
    },
    content: { type: String, required: false },
    items: {
      type: [GleanProductGridItemSchema],
      required: false,
      default: undefined,
    },
    draft: {
      type: GleanInventoryDraftSchema,
      required: false,
      default: undefined,
    },
    options: {
      type: [GleanStrategyOptionSchema],
      required: false,
      default: undefined,
    },
    recommendedStrategyId: { type: String, required: false, default: undefined },
    sourcingPlan: {
      type: GleanSourcingPlanSchema,
      required: false,
      default: undefined,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const GleanChatSchema = new Schema<IGleanChat>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: {
      type: String,
      required: true,
      enum: ["farmer", "restaurant"],
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
      default: "New chat",
    },
    messages: {
      type: [GleanChatMessageSchema],
      default: [],
    },
  },
  { timestamps: true }
);

const GleanChat =
  mongoose.models.GleanChat ||
  mongoose.model<IGleanChat>("GleanChat", GleanChatSchema);

export default GleanChat;
