import mongoose, { Schema, Document, Types } from "mongoose";

export interface ISupplier extends Document {
  name: string;
  typicalMaxOrderValue?: number; // optional; if order value > this => bigOrder signal
  createdAt: Date;
  updatedAt: Date;
}

const SupplierSchema = new Schema<ISupplier>(
  {
    name: { type: String, required: true, trim: true },
    typicalMaxOrderValue: { type: Number, min: 0 },
  },
  { timestamps: true }
);

const Supplier =
  mongoose.models.Supplier ||
  mongoose.model<ISupplier>("Supplier", SupplierSchema);

export default Supplier;
