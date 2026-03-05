import mongoose, { Schema, Document } from "mongoose";

/**
 * Per-category or per-item quality check templates. Used to fill quickQualityChecks
 * in the receiving brief. Keyed by category (e.g. "berries", "herbs") or itemCanonical.
 */
export interface IQualityTemplate extends Document {
  key: string; // category name or itemCanonical
  keyType: "category" | "itemCanonical";
  quickQualityChecks: string[]; // 3–6 bullets
  defaultAcceptableVarianceQtyPercent?: number; // e.g. 5 for ±5%
  defaultPackagingNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const QualityTemplateSchema = new Schema<IQualityTemplate>(
  {
    key: { type: String, required: true, trim: true },
    keyType: {
      type: String,
      enum: ["category", "itemCanonical"],
      required: true,
    },
    quickQualityChecks: {
      type: [String],
      required: true,
      validate: (v: string[]) => v.length >= 3 && v.length <= 6,
    },
    defaultAcceptableVarianceQtyPercent: { type: Number, min: 0, max: 100 },
    defaultPackagingNote: { type: String, trim: true },
  },
  { timestamps: true }
);

QualityTemplateSchema.index({ key: 1, keyType: 1 }, { unique: true });

const QualityTemplate =
  mongoose.models.QualityTemplate ||
  mongoose.model<IQualityTemplate>("QualityTemplate", QualityTemplateSchema);

export default QualityTemplate;
