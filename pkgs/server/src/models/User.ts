import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  name: string;
  email: string;
  auth0Id: string; // Auth0 user ID (sub claim from JWT token)
  role: 'farmer' | 'restaurant' | 'admin';
  avatar?: string; // Base64 data URL or image URL
  /** Canadian postal code (e.g. K1A 0B1), set at registration or in profile. */
  postalCode?: string;
  /** Geocoded from postalCode for maps and listings. */
  latLng?: [number, number];
  createdAt: Date;
}

const userSchema = new Schema<IUser>({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  auth0Id: { type: String, required: true, unique: true, index: true },
  role: { type: String, enum: ['farmer', 'restaurant', 'admin'], required: true },
  avatar: { type: String, required: false },
  postalCode: { type: String, required: false, trim: true },
  latLng: {
    type: [Number],
    required: false,
    validate: {
      validator(v: unknown) {
        return (
          !v ||
          (Array.isArray(v) &&
            v.length === 2 &&
            typeof v[0] === "number" &&
            typeof v[1] === "number")
        );
      },
      message: "latLng must be [latitude, longitude]",
    },
  },
  createdAt: { type: Date, default: Date.now }
});

export const User = mongoose.model<IUser>('User', userSchema);