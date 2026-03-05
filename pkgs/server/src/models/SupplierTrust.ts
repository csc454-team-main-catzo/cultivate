import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * Trust/reliability record per supplier. Used for risk scoring (priorIssues).
 * If no record exists, supplier is treated as "new" (newSupplier +2).
 */
export interface ISupplierTrust extends Document {
  supplierId: Types.ObjectId;
  reliability: number; // 0–1; below threshold => priorIssues
  issueCount: number; // number of prior incidents
  lastUpdated: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SupplierTrustSchema = new Schema<ISupplierTrust>(
  {
    supplierId: {
      type: Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
      unique: true,
    },
    reliability: { type: Number, required: true, min: 0, max: 1 },
    issueCount: { type: Number, default: 0, min: 0 },
    lastUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const SupplierTrust =
  mongoose.models.SupplierTrust ||
  mongoose.model<ISupplierTrust>("SupplierTrust", SupplierTrustSchema);

export default SupplierTrust;
