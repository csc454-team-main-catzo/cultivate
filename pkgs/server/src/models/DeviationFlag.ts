import mongoose, { Schema, Document, Types } from "mongoose";

export type DeviationType =
  | "qty_variance"
  | "pack_size_mismatch"
  | "delivery_window_outside_range"
  | "other";

export type DeviationSeverity = "low" | "medium" | "high";

export interface IDeviationFlag extends Document {
  orderId: Types.ObjectId;
  receivingBriefId: Types.ObjectId;
  type: DeviationType;
  severity: DeviationSeverity;
  description: string;
  suggestedAction: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const DeviationFlagSchema = new Schema<IDeviationFlag>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    receivingBriefId: {
      type: Schema.Types.ObjectId,
      ref: "ReceivingBrief",
      required: true,
    },
    type: {
      type: String,
      enum: [
        "qty_variance",
        "pack_size_mismatch",
        "delivery_window_outside_range",
        "other",
      ],
      required: true,
    },
    severity: {
      type: String,
      enum: ["low", "medium", "high"],
      required: true,
    },
    description: { type: String, required: true },
    suggestedAction: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

DeviationFlagSchema.index({ orderId: 1 });
DeviationFlagSchema.index({ receivingBriefId: 1 });

const DeviationFlag =
  mongoose.models.DeviationFlag ||
  mongoose.model<IDeviationFlag>("DeviationFlag", DeviationFlagSchema);

export default DeviationFlag;
