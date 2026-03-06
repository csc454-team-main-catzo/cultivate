import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import CFG from "../config.js";
import { authMiddleware } from "../middleware/auth.js";
import type { AuthenticatedContext } from "../middleware/types.js";
import { User } from "../models/User.js";
import {
  UserListResponseSchema,
  UserRegisterSchema,
  type UserRegisterInput,
  UserResponseSchema,
  UserUpdateSchema,
  type UserUpdateInput,
} from "../schemas/user.js";

/** Fetch user profile from Auth0 when access token lacks email/name claims */
async function fetchAuth0UserInfo(accessToken: string): Promise<{ email?: string; name?: string }> {
  const res = await fetch(`https://${CFG.AUTH0_DOMAIN}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Auth0 userinfo failed: ${res.status}`);
  }
  const data = (await res.json()) as { email?: string; name?: string; nickname?: string };
  return {
    email: data.email,
    name: data.name || data.nickname,
  };
}

const users = new Hono<AuthenticatedContext>();

users.use(
  describeRoute({
    tags: ["Users"],
  })
);

users.post(
  "/register",
  describeRoute({
    operationId: "registerUser",
    summary: "Complete Auth0 registration by assigning a role",
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: "Registered user",
        content: {
          "application/json": {
            schema: resolver(UserResponseSchema),
          },
        },
      },
      400: { description: "Validation error or user already exists" },
      401: { description: "Unauthorized" },
    },
  }),
  authMiddleware(),
  validator("json", UserRegisterSchema),
  async (c) => {
    try {
      // WORKAROUND: hono-openapi's validator registers types differently than
      // Hono's native validator. The `as never` cast keeps TypeScript happy
      // while runtime validation comes from the middleware above.
      const { role, email: bodyEmail, name: bodyName } = c.req.valid("json" as never) as UserRegisterInput;
      const auth0Id = c.get("auth0Id");
      const token = c.get("token");
      const isNewUser = c.get("isNewUser");

      if (!isNewUser) {
        const existingUser = await User.findOne({ auth0Id });
        if (existingUser) {
          return c.json({ error: "User already registered" }, 400);
        }
      }

      let email = bodyEmail || (token?.email as string) || "";
      let name = bodyName || (token?.name as string) || (token?.nickname as string) || "";

      // Access tokens for custom APIs often omit email/name; try Auth0 userinfo or require from body
      if (!email) {
        const authHeader = c.req.header("Authorization");
        const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();
        if (accessToken) {
          try {
            const userInfo = await fetchAuth0UserInfo(accessToken);
            email = userInfo.email || "";
            name = userInfo.name || name;
          } catch (err) {
            console.error("Auth0 userinfo error:", err);
          }
        }
      }

      if (!email) {
        return c.json(
          { error: "Email not found. Ensure Auth0 includes email scope, or pass email in the request." },
          400
        );
      }

      const user = await User.create({
        auth0Id,
        email,
        name: name || email.split("@")[0],
        role,
      });

      return c.json(user, 201);
    } catch (error: any) {
      if (error.code === 11000) {
        return c.json({ error: "User already exists" }, 400);
      }
      return c.json({ error: error.message }, 400);
    }
  }
);

users.get(
  "/me",
  describeRoute({
    operationId: "getCurrentUser",
    summary: "Return the authenticated user's profile",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: "Authenticated user",
        content: {
          "application/json": {
            schema: resolver(UserResponseSchema),
          },
        },
      },
      401: { description: "Unauthorized" },
      404: { description: "User not found" },
    },
  }),
  authMiddleware(),
  async (c) => {
    try {
      const user = c.get("user");
      if (!user) {
        return c.json(
          { error: "User not found. Please complete registration." },
          404
        );
      }

      return c.json(user, 200);
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  }
);

users.patch(
  "/me",
  describeRoute({
    operationId: "updateCurrentUser",
    summary: "Update the authenticated user's profile",
    security: [{ bearerAuth: [] }],
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              name: { type: "string", maxLength: 32 },
              email: { type: "string", format: "email" },
              avatar: { type: "string", nullable: true },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: "Updated user",
        content: {
          "application/json": {
            schema: resolver(UserResponseSchema),
          },
        },
      },
      400: { description: "Validation error" },
      401: { description: "Unauthorized" },
      404: { description: "User not found" },
    },
  }),
  authMiddleware(),
  validator("json", UserUpdateSchema),
  async (c) => {
    try {
      const user = c.get("user");
      if (!user) {
        return c.json(
          { error: "User not found. Please complete registration." },
          404
        );
      }

      const body = c.req.valid("json" as never) as UserUpdateInput;
      if (body.name !== undefined) user.name = body.name;
      if (body.email !== undefined) user.email = body.email;
      if (body.avatar !== undefined) user.avatar = body.avatar ?? undefined;
      await user.save();

      return c.json(user, 200);
    } catch (error: any) {
      return c.json({ error: error.message }, 400);
    }
  }
);

users.get(
  "/",
  describeRoute({
    operationId: "listUsers",
    summary: "List registered users (Auth0 IDs omitted)",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: "Array of users",
        content: {
          "application/json": {
            schema: resolver(UserListResponseSchema),
          },
        },
      },
      401: { description: "Unauthorized" },
      500: { description: "Server error" },
    },
  }),
  authMiddleware(),
  async (c) => {
    try {
      const userDocs = await User.find().select("-auth0Id");
      return c.json(userDocs, 200);
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  }
);

export default users;