import * as v from "valibot";

/* ---------- Shared Enums ---------- */

export const ListingTypeSchema = v.picklist(
  ["demand", "supply"],
  "Type must be 'demand' or 'supply'"
);

export const ListingStatusSchema = v.picklist(
  ["open", "matched", "fulfilled", "expired"],
  "Status must be 'open', 'matched', 'fulfilled', or 'expired'"
);

/* ---------- Shared Sub-schemas ---------- */

const PopulatedUserSchema = v.object({
  _id: v.string(),
  name: v.string(),
  email: v.string(),
  role: v.optional(v.picklist(["farmer", "restaurant", "admin"])),
});

const ResponseUnitSchema = v.picklist(
  ["kg", "lb", "count", "bunch"],
  "Unit must be one of: kg, lb, count, bunch"
);

const ResponseSubdocSchema = v.object({
  _id: v.string(),
  message: v.string(),
  price: v.number(),
  qty: v.number(),
  unit: v.optional(ResponseUnitSchema, "kg"),
  createdBy: PopulatedUserSchema,
  createdAt: v.string(),
});

/* ---------- Request Schemas ---------- */

/** Create a new listing (demand from a restaurant, or supply from a farmer) */
export const ListingCreateSchema = v.object({
  type: ListingTypeSchema,
  title: v.pipe(
    v.string(),
    v.minLength(1, "Title is required"),
    v.maxLength(150, "Title cannot exceed 150 characters")
  ),
  item: v.pipe(
    v.string(),
    v.minLength(1, "Item is required"),
    v.maxLength(100, "Item name cannot exceed 100 characters")
  ),
  description: v.pipe(
    v.string(),
    v.minLength(1, "Description is required"),
    v.maxLength(2000, "Description cannot exceed 2000 characters")
  ),
  price: v.pipe(v.number(), v.minValue(0, "Price cannot be negative")),
  qty: v.pipe(v.number(), v.minValue(1, "Quantity must be at least 1")),
  unit: v.optional(ResponseUnitSchema, "kg"),
  photos: v.optional(
    v.array(
      v.object({
        imageId: v.pipe(v.string(), v.minLength(1, "Photo imageId is required")),
      })
    )
  ),
  expiresAt: v.optional(v.string("expiresAt must be an ISO date string")),
});

export type ListingCreateInput = v.InferOutput<typeof ListingCreateSchema>;

/** Update an existing listing (partial; owner only) */
export const ListingUpdateSchema = v.partial(
  v.object({
    title: v.pipe(
      v.string(),
      v.minLength(1, "Title cannot be empty"),
      v.maxLength(150, "Title cannot exceed 150 characters")
    ),
    item: v.pipe(
      v.string(),
      v.minLength(1, "Item cannot be empty"),
      v.maxLength(100, "Item cannot exceed 100 characters")
    ),
    description: v.pipe(
      v.string(),
      v.minLength(1, "Description cannot be empty"),
      v.maxLength(2000, "Description cannot exceed 2000 characters")
    ),
    price: v.pipe(v.number(), v.minValue(0, "Price cannot be negative")),
    qty: v.pipe(v.number(), v.minValue(1, "Quantity must be at least 1")),
    unit: ResponseUnitSchema,
    status: ListingStatusSchema,
    photos: v.array(
      v.object({
        imageId: v.pipe(v.string(), v.minLength(1, "Photo imageId is required")),
      })
    ),
  })
);

export type ListingUpdateInput = v.InferOutput<typeof ListingUpdateSchema>;

/** Match with a response (owner only; sets status to matched) */
export const MatchRequestSchema = v.object({
  responseId: v.pipe(
    v.string(),
    v.minLength(1, "Response ID is required")
  ),
});

export type MatchRequestInput = v.InferOutput<typeof MatchRequestSchema>;

/** Add a response to an existing listing */
export const ResponseCreateSchema = v.object({
  message: v.pipe(
    v.string(),
    v.minLength(1, "Message is required"),
    v.maxLength(2000, "Message cannot exceed 2000 characters")
  ),
  price: v.pipe(v.number(), v.minValue(0, "Price cannot be negative")),
  qty: v.pipe(v.number(), v.minValue(1, "Quantity must be at least 1")),
  unit: v.optional(ResponseUnitSchema, "kg"),
});

export type ResponseCreateInput = v.InferOutput<typeof ResponseCreateSchema>;

/* ---------- Response Schemas ---------- */

export const ListingResponseSchema = v.object({
  _id: v.string(),
  type: ListingTypeSchema,
  title: v.string(),
  item: v.string(),
  description: v.string(),
  price: v.number(),
  qty: v.number(),
  unit: v.optional(ResponseUnitSchema, "kg"),
  photos: v.array(
    v.object({
      imageId: v.string(),
    })
  ),
  latLng: v.tuple([v.number(), v.number()]),
  createdBy: PopulatedUserSchema,
  matchedResponseId: v.nullable(v.string()),
  status: ListingStatusSchema,
  responses: v.array(ResponseSubdocSchema),
  createdAt: v.string(),
  updatedAt: v.string(),
  expiresAt: v.nullable(v.string()),
});

export const ListingListResponseSchema = v.array(ListingResponseSchema);
