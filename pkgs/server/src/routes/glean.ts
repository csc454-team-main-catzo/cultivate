import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authMiddleware } from "../middleware/auth.js";
import type { AuthenticatedContext } from "../middleware/types.js";
import GleanChat from "../models/GleanChat.js";
import GleanCart from "../models/GleanCart.js";

const glean = new Hono<AuthenticatedContext>();

const CreateChatBody = v.object({
  role: v.picklist(["farmer", "restaurant"]),
  title: v.optional(v.string()),
});

const EnsureChatBody = v.object({
  role: v.picklist(["farmer", "restaurant"]),
});

const UpdateChatBody = v.object({
  title: v.optional(v.string()),
});

const AppendMessageBody = v.object({
  role: v.picklist(["user", "assistant"]),
  type: v.picklist(["text", "product_grid", "inventory_form"]),
  content: v.optional(v.string()),
  items: v.optional(
    v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        item: v.string(),
        description: v.optional(v.string()),
        price: v.number(),
        qty: v.number(),
        unit: v.optional(v.string()),
        farmerName: v.string(),
        farmerId: v.string(),
        imageUrl: v.optional(v.string()),
      })
    )
  ),
  draft: v.optional(
    v.object({
      title: v.string(),
      item: v.string(),
      description: v.optional(v.string()),
      weightKg: v.number(),
      pricePerKg: v.number(),
      unit: v.optional(v.picklist(["kg", "lb", "count", "bunch"])),
    })
  ),
});

const CartBody = v.object({
  items: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      price: v.number(),
      category: v.string(),
      image: v.string(),
      color: v.string(),
      quantity: v.number(),
    })
  ),
});

async function readJson(c: any): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

glean.get(
  "/chats",
  describeRoute({
    operationId: "listGleanChats",
    summary: "List Glean chat sessions for the current user",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "List of chat sessions" },
      401: { description: "Unauthorized" },
    },
  }),
  authMiddleware(),
  async (c) => {
    const userId = c.get("userId");
    const chats = await GleanChat.find({ user: userId })
      .select("title role createdAt updatedAt")
      .sort({ updatedAt: -1 })
      .lean();
    return c.json(chats, 200);
  }
);

glean.post(
  "/chats",
  describeRoute({
    operationId: "createGleanChat",
    summary: "Create a new Glean chat session",
    security: [{ bearerAuth: [] }],
    responses: {
      201: { description: "Created chat session" },
      400: { description: "Invalid request" },
      401: { description: "Unauthorized" },
    },
  }),
  authMiddleware(),
  async (c) => {
    const userId = c.get("userId");
    const raw = await readJson(c);
    const parsed = v.safeParse(CreateChatBody, raw);
    if (!parsed.success) return c.json({ error: "Invalid request body" }, 400);
    const body = parsed.output;

    const title = (body.title || "New chat").slice(0, 120);
    const chat = await GleanChat.create({
      user: userId,
      role: body.role,
      title,
      messages: [],
    });
    return c.json(chat, 201);
  }
);

glean.post(
  "/chats/ensure",
  describeRoute({
    operationId: "ensureGleanChat",
    summary: "Get or create the default Glean chat for a user+role",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Existing or created chat session" },
      400: { description: "Invalid request" },
      401: { description: "Unauthorized" },
    },
  }),
  authMiddleware(),
  async (c) => {
    const userId = c.get("userId");
    const raw = await readJson(c);
    const parsed = v.safeParse(EnsureChatBody, raw);
    if (!parsed.success) return c.json({ error: "Invalid request body" }, 400);
    const body = parsed.output;

    const existing = await GleanChat.findOne({ user: userId, role: body.role })
      .sort({ updatedAt: -1 })
      .lean();
    if (existing) return c.json(existing, 200);

    const created = await GleanChat.create({
      user: userId,
      role: body.role,
      title: "New chat",
      messages: [],
    });
    return c.json(created, 200);
  }
);

glean.get(
  "/chats/:id",
  describeRoute({
    operationId: "getGleanChat",
    summary: "Get a Glean chat session (with messages)",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Chat session" },
      401: { description: "Unauthorized" },
      404: { description: "Not found" },
    },
  }),
  authMiddleware(),
  async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const chat = await GleanChat.findOne({ _id: id, user: userId }).lean();
    if (!chat) return c.json({ error: "Chat not found" }, 404);
    return c.json(chat, 200);
  }
);

glean.patch(
  "/chats/:id",
  describeRoute({
    operationId: "updateGleanChat",
    summary: "Update a Glean chat session (e.g. title)",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Updated chat session" },
      400: { description: "Invalid request" },
      401: { description: "Unauthorized" },
      404: { description: "Not found" },
    },
  }),
  authMiddleware(),
  async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const raw = await readJson(c);
    const parsed = v.safeParse(UpdateChatBody, raw);
    if (!parsed.success) return c.json({ error: "Invalid request body" }, 400);
    const body = parsed.output;

    const update: Record<string, unknown> = {};
    if (typeof body.title === "string") update.title = body.title.slice(0, 120);

    const chat = await GleanChat.findOneAndUpdate(
      { _id: id, user: userId },
      { $set: update },
      { new: true }
    ).lean();
    if (!chat) return c.json({ error: "Chat not found" }, 404);
    return c.json(chat, 200);
  }
);

glean.post(
  "/chats/:id/messages",
  describeRoute({
    operationId: "appendGleanChatMessage",
    summary: "Append a message to a Glean chat session",
    security: [{ bearerAuth: [] }],
    responses: {
      201: { description: "Appended message" },
      400: { description: "Invalid request" },
      401: { description: "Unauthorized" },
      404: { description: "Not found" },
    },
  }),
  authMiddleware(),
  async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const raw = await readJson(c);
    const parsed = v.safeParse(AppendMessageBody, raw);
    if (!parsed.success) return c.json({ error: "Invalid request body" }, 400);
    const body = parsed.output;

    const chat = await GleanChat.findOne({ _id: id, user: userId });
    if (!chat) return c.json({ error: "Chat not found" }, 404);

    chat.messages.push({
      role: body.role,
      type: body.type,
      content: body.content,
      items: body.items,
      draft: body.draft,
      createdAt: new Date(),
    } as any);

    await chat.save();
    const last = chat.messages[chat.messages.length - 1];
    return c.json(last, 201);
  }
);

glean.get(
  "/chats/:id/cart",
  describeRoute({
    operationId: "getGleanChatCart",
    summary: "Get the saved checkout cart for a Glean chat",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Cart items" },
      401: { description: "Unauthorized" },
      404: { description: "Chat not found" },
    },
  }),
  authMiddleware(),
  async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");

    const chat = await GleanChat.findOne({ _id: id, user: userId }).select("_id").lean();
    if (!chat) return c.json({ error: "Chat not found" }, 404);

    const cart = await GleanCart.findOne({ user: userId, chat: id }).lean();
    return c.json(
      {
        items: cart?.items ?? [],
        updatedAt: cart?.updatedAt ?? null,
      },
      200
    );
  }
);

glean.put(
  "/chats/:id/cart",
  describeRoute({
    operationId: "saveGleanChatCart",
    summary: "Save/replace the checkout cart for a Glean chat",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Saved cart" },
      400: { description: "Invalid request" },
      401: { description: "Unauthorized" },
      404: { description: "Chat not found" },
    },
  }),
  authMiddleware(),
  async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");

    const chat = await GleanChat.findOne({ _id: id, user: userId }).select("_id").lean();
    if (!chat) return c.json({ error: "Chat not found" }, 404);

    const raw = await readJson(c);
    const parsed = v.safeParse(CartBody, raw);
    if (!parsed.success) return c.json({ error: "Invalid request body" }, 400);
    const body = parsed.output;

    const items = body.items.map((it) => ({
      ...it,
      quantity: Math.max(1, Math.floor(it.quantity)),
    }));

    const saved = await GleanCart.findOneAndUpdate(
      { user: userId, chat: id },
      { $set: { items } },
      { upsert: true, new: true }
    ).lean();

    return c.json(
      {
        items: saved?.items ?? items,
        updatedAt: saved?.updatedAt ?? null,
      },
      200
    );
  }
);

export default glean;

