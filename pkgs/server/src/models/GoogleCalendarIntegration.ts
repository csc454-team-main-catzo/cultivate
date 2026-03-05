import mongoose, { Schema, Document, Types } from "mongoose";

export interface IGoogleCalendarIntegration extends Document {
  userId: Types.ObjectId;
  provider: "google";
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  tokenExpiryISO: string;
  calendarId: string;
  needsReconnect: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const GoogleCalendarIntegrationSchema = new Schema<IGoogleCalendarIntegration>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    provider: { type: String, enum: ["google"], required: true, default: "google" },
    accessTokenEncrypted: { type: String, required: true },
    refreshTokenEncrypted: { type: String, default: null },
    tokenExpiryISO: { type: String, required: true },
    calendarId: { type: String, required: true, default: "primary" },
    needsReconnect: { type: Boolean, default: false },
  },
  { timestamps: true }
);

GoogleCalendarIntegrationSchema.index({ userId: 1 });

const GoogleCalendarIntegration =
  mongoose.models.GoogleCalendarIntegration ||
  mongoose.model<IGoogleCalendarIntegration>("GoogleCalendarIntegration", GoogleCalendarIntegrationSchema);

export default GoogleCalendarIntegration;
