/**
 * Auth helpers for the app.
 * Use useUser() from providers/userContext for current user and role.
 */

import type { RegisterUser201Response } from "sdk";

export type AppUser = RegisterUser201Response;

export type UserRole = "farmer" | "restaurant" | "admin";

/** Get role from app user. Use with useUser().appUser */
export function getUserRole(user: AppUser | null): UserRole | undefined {
  if (!user?.role) return undefined;
  return user.role as UserRole;
}
