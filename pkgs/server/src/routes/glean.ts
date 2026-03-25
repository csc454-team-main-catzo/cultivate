import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authMiddleware } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/rateLimit.js";
import type { AuthenticatedContext } from "../middleware/types.js";
import GleanChat from "../models/GleanChat.js";
import GleanCart from "../models/GleanCart.js";
import { runGleanAgent, type InventoryConstraints } from "../services/gleanAgent.js";
import Listing from "../models/Listing.js";
import { getProduceMatchTerms } from "../services/produceMatcher.js";
import CFG from "../config.js";
import { runDailyPriceUpdate } from "../services/dailyPriceUpdater.js";

const glean = new Hono<AuthenticatedContext>();

/** Stopwords so we match by produce type (e.g. "tomato") not "fresh"/"delivery". */
const MATCH_STOP_WORDS = new Set([
  "i", "need", "want", "looking", "for", "some", "by", "the", "a", "an",
  "kg", "lb", "and", "or", "to", "this", "week", "next", "please", "can", "you",
  "fresh", "delivery", "farmers", "find", "with", "from", "have", "get", "buy",
  "ordering", "bulk", "local", "organic", "ugly", "produce", "supply", "need",
]);

function extractSearchTerms(prompt: string): string[] {
  const lower = prompt.toLowerCase().trim();
  const words = lower.replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
  const terms: string[] = [];
  for (const w of words) {
    if (w.length >= 2 && !MATCH_STOP_WORDS.has(w) && !/^\d+$/.test(w)) {
      terms.push(w.replace(/s$/, ""));
    }
  }
  return terms.length > 0 ? terms : ["produce"];
}

function buildMatchTextQuery(terms: string[]) {
  if (terms.length === 0) return {};
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regexes = escaped.map((e) => new RegExp(e, "i"));
  return {
    $or: regexes.flatMap((r) => [
      { item: r },
      { title: r },
      { description: r },
    ]),
  };
}

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

const StrategyMetricsSchema = v.object({
  totalCost: v.number(),
  supplierCount: v.number(),
  coveragePercent: v.number(),
  avgMatchScore: v.number(),
  estimatedDelivery: v.optional(v.string()),
});

const StrategyOptionSchema = v.object({
  strategyId: v.string(),
  name: v.string(),
  description: v.string(),
  rank: v.number(),
  metrics: StrategyMetricsSchema,
  tradeoffs: v.array(v.string()),
});

const DeliveryWindowSchema = v.object({
  startAt: v.string(),
  endAt: v.string(),
});

const StrategyAllocationSchema = v.object({
  lineItemIndex: v.number(),
  lineItemName: v.string(),
  supplier: v.object({
    listingId: v.string(),
    supplierId: v.string(),
    supplierName: v.string(),
    item: v.string(),
    title: v.string(),
    pricePerUnit: v.number(),
    imageId: v.optional(v.string()),
  }),
  allocatedQty: v.number(),
  unit: v.string(),
  subtotal: v.number(),
  matchType: v.string(),
  matchScore: v.number(),
  deliveryWindow: v.optional(DeliveryWindowSchema),
});

const SourcingPlanSchema = v.object({
  orderId: v.string(),
  strategies: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      allocations: v.array(StrategyAllocationSchema),
    })
  ),
  unfulfillable: v.array(
    v.object({
      lineItemName: v.string(),
      qtyNeeded: v.number(),
      qtyAvailable: v.number(),
      reason: v.string(),
    })
  ),
  summary: v.string(),
  reasoning: v.string(),
});

const AppendMessageBody = v.object({
  role: v.picklist(["user", "assistant"]),
  type: v.picklist(["text", "product_grid", "inventory_form", "strategy_options"]),
  content: v.optional(v.string()),
  /** User text message: optional image attachment id (chat upload). */
  imageId: v.optional(v.string()),
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
      imageId: v.optional(v.string()),
      deliveryWindow: v.optional(DeliveryWindowSchema),
    })
  ),
  options: v.optional(v.array(StrategyOptionSchema)),
  recommendedStrategyId: v.optional(v.nullable(v.string())),
  sourcingPlan: v.optional(SourcingPlanSchema),
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

const AgentBody = v.object({
  prompt: v.pipe(v.string(), v.minLength(1, "prompt is required")),
  role: v.picklist(["farmer", "restaurant"]),
  priorMessages: v.optional(
    v.array(
      v.object({
        role: v.picklist(["user", "assistant"]),
        content: v.optional(v.string()),
        type: v.optional(v.string()),
      })
    )
  ),
  inventoryConstraints: v.optional(
    v.object({
      maxPricePerKg: v.optional(v.number()),
      preferredUnits: v.optional(v.array(v.picklist(["kg", "lb", "count", "bunch"]))),
      maxWeightKg: v.optional(v.number()),
    })
  ),
  /** When set with role=famer, use this uploaded image (Azure CV) to fill title/item/description; user text fills price, qty, delivery window. */
  imageId: v.optional(v.pipe(v.string(), v.minLength(1))),
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

glean.delete(
  "/chats/:id",
  describeRoute({
    operationId: "deleteGleanChat",
    summary: "Delete a Glean chat session",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Deleted" },
      401: { description: "Unauthorized" },
      404: { description: "Not found" },
    },
  }),
  authMiddleware(),
  async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const chat = await GleanChat.findOneAndDelete({ _id: id, user: userId });
    if (!chat) return c.json({ error: "Chat not found" }, 404);
    await GleanCart.deleteMany({ user: userId, chat: id });
    return c.json({ ok: true }, 200);
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
      imageId: body.imageId,
      items: body.items,
      draft: body.draft,
      options: body.options,
      recommendedStrategyId: body.recommendedStrategyId,
      sourcingPlan: body.sourcingPlan,
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

/** POST /match — Fuzzy search listings: restaurant sees supply (from farmers), farmer sees demand (from restaurants). */
glean.post(
  "/match",
  authMiddleware({ optional: true }),
  async (c) => {
    try {
      const raw = await readJson(c);
      const body = raw as { prompt?: string; role?: string };
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      const role = body.role === "farmer" || body.role === "restaurant" ? body.role : "restaurant";

      if (!prompt) return c.json({ error: "prompt is required" }, 400);

      const terms = extractSearchTerms(prompt);
      const taxonomyTerms = await getProduceMatchTerms(terms);
      const matchTerms = taxonomyTerms.length > 0 ? taxonomyTerms : terms;
      const textQuery = buildMatchTextQuery(matchTerms);

      const listingType = role === "farmer" ? "demand" : "supply";
      const creatorRole = role === "farmer" ? "restaurant" : "farmer";

      let listings = await Listing.find({
        type: listingType,
        status: "open",
        ...textQuery,
      })
        .populate("createdBy", "name email role")
        .sort({ createdAt: -1 })
        .limit(30)
        .lean();

      listings = listings.filter(
        (doc) => (doc.createdBy as { role?: string } | null)?.role === creatorRole
      ).slice(0, 20);

      if (listings.length === 0) {
        listings = await Listing.find({ type: listingType, status: "open" })
          .populate("createdBy", "name email role")
          .sort({ createdAt: -1 })
          .limit(30)
          .lean();
        listings = listings.filter(
          (doc) => (doc.createdBy as { role?: string } | null)?.role === creatorRole
        ).slice(0, 20);
      }

      const items = listings.map((doc) => {
        const createdBy = doc.createdBy as { _id: unknown; name?: string } | null;
        const photo = Array.isArray(doc.photos) && doc.photos.length > 0 ? doc.photos[0] : null;
        return {
          id: String(doc._id),
          listingId: String(doc._id),
          title: doc.title ?? "",
          item: doc.item ?? "",
          description: doc.description ?? undefined,
          price: doc.price ?? 0,
          qty: doc.qty ?? 0,
          unit: doc.unit ?? "kg",
          farmerName: createdBy?.name ?? (role === "farmer" ? "Restaurant" : "Farmer"),
          farmerId: createdBy?._id != null ? String(createdBy._id) : "",
          imageId: photo?.imageId != null ? String(photo.imageId) : undefined,
        };
      });

      return c.json({ query: prompt, items, role });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);

/** POST /agent — Glean Agent: LLM + listing search, returns structured intro + payload. */
glean.post(
  "/agent",
  describeRoute({
    operationId: "gleanAgent",
    summary: "Run Glean agent: forward prompt (and optional context) to LLM and listing search, return intro text + product suggestions or draft listing",
    security: [{ bearerAuth: [] }, {}],
    responses: {
      200: { description: "Intro text and structured payload (product_grid or inventory_form)" },
      400: { description: "Invalid request" },
      429: { description: "Rate limit exceeded" },
    },
  }),
  authMiddleware({ optional: true }),
  rateLimiter({
    max: CFG.RATE_LIMIT_AGENT_MAX,
    windowMs: CFG.RATE_LIMIT_AGENT_WINDOW_MS,
    message: "Too many requests. Please wait a moment before trying again.",
  }),
  async (c) => {
    try {
      const raw = await readJson(c);
      const parsed = v.safeParse(AgentBody, raw);
      if (!parsed.success) {
        return c.json({ error: "Invalid request body", details: parsed.issues }, 400);
      }
      const body = parsed.output;
      const prompt = body.prompt.trim();
      const role = body.role;

      const userId = c.get("userId") ?? undefined;
      if (body.imageId && !userId) {
        return c.json(
          {
            error:
              "Authentication required to generate a listing draft from your photo. Please sign in and try again.",
          },
          401
        );
      }

      const result = await runGleanAgent({
        prompt,
        role,
        priorMessages: body.priorMessages ?? [],
        inventoryConstraints: body.inventoryConstraints,
        imageId: body.imageId,
        userId: body.imageId ? userId : undefined,
      });
      return c.json({ introText: result.introText, payload: result.payload });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);

/** POST /prices/refresh — Manually trigger a daily wholesale price update from AAFC Infohort. */
glean.post(
  "/prices/refresh",
  describeRoute({
    operationId: "refreshWholesalePrices",
    summary:
      "Trigger a manual refresh of Toronto wholesale produce prices from AAFC Infohort and adjust open listing prices",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "Price update result" },
      401: { description: "Unauthorized" },
    },
  }),
  authMiddleware(),
  async (c) => {
    try {
      const result = await runDailyPriceUpdate();
      return c.json(result, 200);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);

export default glean;
