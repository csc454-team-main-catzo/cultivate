import mongoose, { Schema, Document, Types } from "mongoose";

export type GleanMessageRole = "user" | "assistant";
export type GleanMessageType = "text" | "product_grid" | "inventory_form";

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

export interface IGleanChatMessage {
  _id: Types.ObjectId;
  role: GleanMessageRole;
  type: GleanMessageType;
  content?: string;
  items?: IGleanProductGridItem[];
  draft?: IGleanInventoryDraftData;
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

const GleanChatMessageSchema = new Schema<IGleanChatMessage>(
  {
    role: { type: String, required: true, enum: ["user", "assistant"] },
    type: {
      type: String,
      required: true,
      enum: ["text", "product_grid", "inventory_form"],
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
