import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  name: string;
  email: string;
  auth0Id: string; // Auth0 user ID (sub claim from JWT token)
  role: 'farmer' | 'restaurant' | 'admin';
  avatar?: string; // Base64 data URL or image URL
  createdAt: Date;
}

const userSchema = new Schema<IUser>({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  auth0Id: { type: String, required: true, unique: true, index: true },
  role: { type: String, enum: ['farmer', 'restaurant', 'admin'], required: true },
  avatar: { type: String, required: false },
  createdAt: { type: Date, default: Date.now }
});

export const User = mongoose.model<IUser>('User', userSchema);