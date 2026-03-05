import mongoose, { Schema, Document, Types } from "mongoose";

export type OrderUnit = "kg" | "lb" | "count" | "bunch" | "case";

export interface IOrderLineItem {
  itemCanonical: string;
  itemDisplayName: string;
  expectedQty: number;
  unit: OrderUnit;
  packSize?: string; // e.g. "12/1lb", "20lb case"
  category?: string; // e.g. "berries", "herbs", "seafood"
  substitutionRules?: string;
}

export interface IOrder extends Document {
  restaurantId: Types.ObjectId;
  orderDate: Date; // date part used for "today's orders"
  supplierId: Types.ObjectId;
  lineItems: IOrderLineItem[];
  deliveryWindowStart: Date;
  deliveryWindowEnd: Date;
  status: "draft" | "placed" | "confirmed" | "delivered" | "cancelled";
  createdAt: Date;
  updatedAt: Date;
}

const OrderLineItemSchema = new Schema<IOrderLineItem>(
  {
    itemCanonical: { type: String, required: true, trim: true },
    itemDisplayName: { type: String, required: true, trim: true },
    expectedQty: { type: Number, required: true, min: 0 },
    unit: {
      type: String,
      enum: ["kg", "lb", "count", "bunch", "case"],
      default: "kg",
    },
    packSize: { type: String, trim: true },
    category: { type: String, trim: true },
    substitutionRules: { type: String, trim: true },
  },
  { _id: false }
);

const OrderSchema = new Schema<IOrder>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    orderDate: { type: Date, required: true },
    supplierId: { type: Schema.Types.ObjectId, ref: "Supplier", required: true },
    lineItems: { type: [OrderLineItemSchema], default: [] },
    deliveryWindowStart: { type: Date, required: true },
    deliveryWindowEnd: { type: Date, required: true },
    status: {
      type: String,
      enum: ["draft", "placed", "confirmed", "delivered", "cancelled"],
      default: "placed",
    },
  },
  { timestamps: true }
);

OrderSchema.index({ restaurantId: 1, orderDate: 1 });
OrderSchema.index({ supplierId: 1, orderDate: 1 });

const Order =
  mongoose.models.Order || mongoose.model<IOrder>("Order", OrderSchema);

export default Order;
