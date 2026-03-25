import * as v from "valibot";
import { CanadianPostalSchema } from "../utils/canadianPostal.js";

export const UserRoleSchema = v.picklist(
  ["farmer", "restaurant"],
  "Role must be 'farmer' or 'restaurant'"
);

const UserRoleResponseSchema = v.picklist(
  ["farmer", "restaurant", "admin"],
  "Role must be 'farmer', 'restaurant', or 'admin'"
);

export const UserRegisterSchema = v.object({
  role: UserRoleSchema,
  email: v.optional(v.string()),
  name: v.optional(v.string()),
  postalCode: CanadianPostalSchema,
});

export type UserRegisterInput = v.InferOutput<typeof UserRegisterSchema>;

export const UserUpdateSchema = v.object({
  name: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(32))),
  email: v.optional(v.pipe(v.string(), v.email())),
  avatar: v.optional(
    v.nullable(v.pipe(v.string(), v.maxLength(300000)))
  ), // Base64 data URL, ~225KB max
  postalCode: v.optional(CanadianPostalSchema),
});

export type UserUpdateInput = v.InferOutput<typeof UserUpdateSchema>;

const BaseUserSchema = v.object({
  _id: v.string(),
  name: v.string(),
  email: v.string(),
  role: UserRoleResponseSchema,
  auth0Id: v.string(),
  avatar: v.optional(v.nullable(v.string())),
  postalCode: v.optional(v.string()),
  latLng: v.optional(v.tuple([v.number(), v.number()])),
  createdAt: v.string(),
});

export const UserResponseSchema = BaseUserSchema;

export const PublicUserResponseSchema = v.pick(BaseUserSchema, [
  "_id",
  "name",
  "email",
  "role",
  "createdAt",
]);

export const UserListResponseSchema = v.array(PublicUserResponseSchema);
