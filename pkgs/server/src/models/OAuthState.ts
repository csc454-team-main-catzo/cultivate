import mongoose, { Schema, Document } from "mongoose";

export interface IOAuthState extends Document {
  state: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

const OAuthStateSchema = new Schema<IOAuthState>(
  {
    state: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

OAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL: delete when expiresAt is reached

const OAuthState =
  mongoose.models.OAuthState ||
  mongoose.model<IOAuthState>("OAuthState", OAuthStateSchema);

export default OAuthState;
