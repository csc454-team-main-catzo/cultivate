import mongoose, { Schema, Document, Types } from "mongoose";

export interface IAuditLog extends Document {
  eventType: string;
  entityId: Types.ObjectId | string; // Order, ReceivingBrief, Supplier, etc.
  entityType?: string; // "Order" | "ReceivingBrief" | "SupplierConfirmation" | ...
  payload: Record<string, unknown>;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    eventType: { type: String, required: true, index: true },
    entityId: { type: Schema.Types.Mixed, required: true }, // ObjectId or string
    entityType: { type: String, index: true },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AuditLogSchema.index({ entityId: 1, eventType: 1 });
AuditLogSchema.index({ createdAt: -1 });

const AuditLog =
  mongoose.models.AuditLog ||
  mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);

export default AuditLog;
