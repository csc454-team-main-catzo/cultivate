import mongoose, { Schema, Document, Types } from "mongoose";

export type RiskTier = "LOW" | "MEDIUM" | "HIGH";

export interface IReceivingBriefLineItem {
  itemCanonical: string;
  itemDisplayName: string;
  expectedQty: number;
  unit: string;
  packagingExpectation: string; // "Not specified; confirm pack size" if unknown
  acceptableVariance: string; // policy-based description
  quickQualityChecks: string[];
  substitutionRules: string;
  mismatchProcedure: string;
  confidence: string;
  assumptions: string;
}

export interface IReceivingBriefSupplierSection {
  supplierId: Types.ObjectId;
  supplierName: string;
  orderId: Types.ObjectId;
  riskTier: RiskTier;
  riskScore: number;
  confirmationStatus: "pending" | "confirmed" | "not_required";
  /** Optional: set at midday check-in when supplier provides tracking. */
  trackingStatus?: string;
  lineItems: IReceivingBriefLineItem[];
}

export interface IReceivingBrief extends Document {
  restaurantId: Types.ObjectId;
  briefDate: Date; // date (YYYY-MM-DD) this brief is for
  sections: IReceivingBriefSupplierSection[];
  kitchenUiJson?: Record<string, unknown>; // optional front-end rendering
  createdAt: Date;
  updatedAt: Date;
}

const ReceivingBriefLineItemSchema = new Schema<IReceivingBriefLineItem>(
  {
    itemCanonical: { type: String, required: true },
    itemDisplayName: { type: String, required: true },
    expectedQty: { type: Number, required: true },
    unit: { type: String, required: true },
    packagingExpectation: { type: String, required: true },
    acceptableVariance: { type: String, required: true },
    quickQualityChecks: { type: [String], default: [] },
    substitutionRules: { type: String, default: "" },
    mismatchProcedure: { type: String, default: "" },
    confidence: { type: String, default: "" },
    assumptions: { type: String, default: "" },
  },
  { _id: false }
);

const ReceivingBriefSupplierSectionSchema =
  new Schema<IReceivingBriefSupplierSection>(
    {
      supplierId: { type: Schema.Types.ObjectId, ref: "Supplier", required: true },
      supplierName: { type: String, required: true },
      orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
      riskTier: {
        type: String,
        enum: ["LOW", "MEDIUM", "HIGH"],
        required: true,
      },
      riskScore: { type: Number, required: true },
      confirmationStatus: {
        type: String,
        enum: ["pending", "confirmed", "not_required"],
        default: "pending",
      },
      trackingStatus: { type: String, default: "" },
      lineItems: { type: [ReceivingBriefLineItemSchema], default: [] },
    },
    { _id: false }
  );

const ReceivingBriefSchema = new Schema<IReceivingBrief>(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    briefDate: { type: Date, required: true },
    sections: {
      type: [ReceivingBriefSupplierSectionSchema],
      default: [],
    },
    kitchenUiJson: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

ReceivingBriefSchema.index({ restaurantId: 1, briefDate: 1 }, { unique: true });

const ReceivingBrief =
  mongoose.models.ReceivingBrief ||
  mongoose.model<IReceivingBrief>("ReceivingBrief", ReceivingBriefSchema);

export default ReceivingBrief;
