import mongoose, { Schema, Document, Types } from "mongoose";

export type RiskTier = "LOW" | "MEDIUM" | "HIGH";

export interface ISupplierConfirmationRequest extends Document {
  orderId: Types.ObjectId;
  supplierId: Types.ObjectId;
  message: string;
  requiredFields: string[]; // e.g. ["confirmQty", "packSize", "harvestDate", "deliveryWindow"]; HIGH adds "photoUrl"
  riskTier: RiskTier;
  status: "pending" | "confirmed";
  createdAt: Date;
  updatedAt: Date;
}

const SupplierConfirmationRequestSchema =
  new Schema<ISupplierConfirmationRequest>(
    {
      orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
      supplierId: { type: Schema.Types.ObjectId, ref: "Supplier", required: true },
      message: { type: String, required: true },
      requiredFields: { type: [String], default: [] },
      riskTier: {
        type: String,
        enum: ["LOW", "MEDIUM", "HIGH"],
        required: true,
      },
      status: {
        type: String,
        enum: ["pending", "confirmed"],
        default: "pending",
      },
    },
    { timestamps: true }
  );

SupplierConfirmationRequestSchema.index({ orderId: 1 }, { unique: true });
SupplierConfirmationRequestSchema.index({ supplierId: 1, status: 1 });

const SupplierConfirmationRequest =
  mongoose.models.SupplierConfirmationRequest ||
  mongoose.model<ISupplierConfirmationRequest>(
    "SupplierConfirmationRequest",
    SupplierConfirmationRequestSchema
  );

export default SupplierConfirmationRequest;
