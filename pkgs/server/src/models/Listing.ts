import mongoose, { Schema, Document, Types } from "mongoose";

/* ---------- Response (offer) subdocument ---------- */

export type ResponseUnit = "kg" | "lb" | "count" | "bunch";

export interface IResponse {
  _id: Types.ObjectId;
  message: string;
  price: number;
  qty: number;
  unit: ResponseUnit;
  createdBy: Types.ObjectId;
  createdAt: Date;
}

const ResponseSchema = new Schema<IResponse>(
  {
    message: {
      type: String,
      required: [true, "Response message is required"],
      trim: true,
      maxlength: [2000, "Response message cannot exceed 2000 characters"],
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price cannot be negative"],
    },
    qty: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [1, "Quantity must be at least 1"],
    },
    unit: {
      type: String,
      enum: {
        values: ["kg", "lb", "count", "bunch"],
        message: "{VALUE} is not a valid unit",
      },
      default: "kg",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "CreatedBy is required"],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

/* ---------- Listing document ---------- */

/**
 * A listing represents either:
 *   - "demand" → a restaurant seeking produce
 *   - "supply" → a farmer offering produce
 *
 * Other users can respond with embedded offers in the `responses` array.
 */
export interface IListing extends Document {
  type: "demand" | "supply";
  title: string;
  item: string;
  description: string;
  price: number;
  qty: number;
  unit: string;
  photos: Array<{ imageId: string }>;
  latLng: [number, number];
  /** Copied from creator profile at post time; not exposed in public API responses. */
  postalCode?: string;
  createdBy: Types.ObjectId;
  matchedResponseId: Types.ObjectId | null;
  status: "open" | "matched" | "fulfilled" | "expired";
  responses: IResponse[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

const ListingSchema = new Schema<IListing>(
  {
    type: {
      type: String,
      enum: {
        values: ["demand", "supply"],
        message: "{VALUE} is not a valid listing type",
      },
      required: [true, "Listing type is required"],
    },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      maxlength: [150, "Title cannot exceed 150 characters"],
    },
    item: {
      type: String,
      required: [true, "Item is required"],
      trim: true,
      maxlength: [100, "Item name cannot exceed 100 characters"],
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      maxlength: [2000, "Description cannot exceed 2000 characters"],
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price cannot be negative"],
    },
    qty: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [1, "Quantity must be at least 1"],
    },
    unit: {
      type: String,
      enum: {
        values: ["kg", "lb", "count", "bunch"],
        message: "{VALUE} is not a valid unit",
      },
      default: "kg",
    },
    photos: {
      type: [
        {
          imageId: {
            type: String,
            required: [true, "Photo imageId is required"],
            trim: true,
          },
        },
      ],
      default: [],
    },
    latLng: {
      type: [Number],
      required: [true, "Location (latLng) is required"],
      validate: {
        validator: (v: number[]) =>
          v.length === 2 &&
          v[0] >= -90 &&
          v[0] <= 90 &&
          v[1] >= -180 &&
          v[1] <= 180,
        message:
          "latLng must be a [latitude, longitude] pair with valid coordinates",
      },
    },
    postalCode: {
      type: String,
      required: false,
      trim: true,
      select: false,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "CreatedBy is required"],
    },
    matchedResponseId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    status: {
      type: String,
      enum: {
        values: ["open", "matched", "fulfilled", "expired"],
        message: "{VALUE} is not a valid listing status",
      },
      default: "open",
    },
    responses: {
      type: [ResponseSchema],
      default: [],
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/* ---------- Indexes ---------- */
ListingSchema.index({ type: 1, status: 1 });
ListingSchema.index({ createdBy: 1 });
ListingSchema.index({ item: 1, type: 1, status: 1 });

const Listing =
  mongoose.models.Listing ||
  mongoose.model<IListing>("Listing", ListingSchema);

export default Listing;
