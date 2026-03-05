import mongoose, { Schema, Document, Types } from "mongoose";

export type RiskTier = "LOW" | "MEDIUM" | "HIGH";

export interface ISupplierConfirmationSnapshot extends Document {
  orderId: Types.ObjectId;
  supplierId: Types.ObjectId;
  riskTier: RiskTier;
  confirmedQty?: string; // freeform or structured per line
  confirmedPackSize?: string;
  harvestDate?: string;
  deliveryWindow?: string;
  photoUrl?: string; // HIGH tier: packed case label or harvest bin
  rawPayload: Record<string, unknown>; // full submit body for audit
  confirmedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SupplierConfirmationSnapshotSchema =
  new Schema<ISupplierConfirmationSnapshot>(
    {
      orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
      supplierId: { type: Schema.Types.ObjectId, ref: "Supplier", required: true },
      riskTier: {
        type: String,
        enum: ["LOW", "MEDIUM", "HIGH"],
        required: true,
      },
      confirmedQty: { type: String },
      confirmedPackSize: { type: String },
      harvestDate: { type: String },
      deliveryWindow: { type: String },
      photoUrl: { type: String },
      rawPayload: { type: Schema.Types.Mixed, default: {} },
      confirmedAt: { type: Date, required: true, default: Date.now },
    },
    { timestamps: true }
  );

SupplierConfirmationSnapshotSchema.index({ orderId: 1 }, { unique: true });
SupplierConfirmationSnapshotSchema.index({ supplierId: 1, confirmedAt: -1 });

const SupplierConfirmationSnapshot =
  mongoose.models.SupplierConfirmationSnapshot ||
  mongoose.model<ISupplierConfirmationSnapshot>(
    "SupplierConfirmationSnapshot",
    SupplierConfirmationSnapshotSchema
  );

export default SupplierConfirmationSnapshot;
