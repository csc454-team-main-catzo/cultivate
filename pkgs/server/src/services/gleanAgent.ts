/**
 * Glean Agent: forwards user prompts to an LLM and/or listing search,
 * returns structured outputs (intro text + product suggestions or draft listing).
 * Chat UX pattern aligned with 21st.dev Chat App template: https://21st.dev/agents/docs/templates/chat-app
 *
 * Both farmer and restaurant use POST /api/glean/agent. Farmer gets an LLM draft (inventory_form);
 * restaurant gets fuzzy-matched supply listings (from farmers) and an optional LLM-generated intro.
 */

// Use namespace-safe import for Vercel/isolatedModules: avoid "OpenAI" as type and ensure constructable
import OpenAIModule from "openai";
import Listing from "../models/Listing.js";
import { getProduceMatchTerms } from "./produceMatcher.js";
import { getDraftSuggestedFieldsFromImage } from "./draftFromImage.js";

/** Minimal type for OpenAI-compatible chat client (avoids using package namespace as type). */
interface LLMClient {
  chat: {
    completions: {
      create(params: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        response_format?: { type: string };
        max_tokens?: number;
      }): Promise<{ choices: Array<{ message?: { content?: string | null } }> }>;
    };
  };
}

/** Resolve OpenAI constructor (handles ESM default vs CJS/namespace interop). */
function getOpenAIConstructor(): new (opts: { apiKey: string; baseURL?: string }) => LLMClient {
  const M = OpenAIModule as unknown as
    | (new (opts: { apiKey: string; baseURL?: string }) => LLMClient)
    | { default?: new (opts: { apiKey: string; baseURL?: string }) => LLMClient; OpenAI?: new (opts: { apiKey: string; baseURL?: string }) => LLMClient };
  const Ctor = (typeof M === "function" ? M : M?.default ?? (M as { OpenAI?: unknown }).OpenAI ?? M) as new (opts: { apiKey: string; baseURL?: string }) => LLMClient;
  if (typeof Ctor !== "function") {
    throw new Error("[Glean] OpenAI SDK: expected constructor; check openai package version.");
  }
  return Ctor;
}

/** OpenAI-compatible client: Groq (free), OpenRouter (free models), or OpenAI. Prefer free providers when keys are set. */
function getLLMClient(): LLMClient | null {
  try {
    const NewCtor = getOpenAIConstructor();
    if (process.env.GROQ_API_KEY) {
      return new NewCtor({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: "https://api.groq.com/openai/v1",
      });
    }
    if (process.env.OPENROUTER_API_KEY) {
      return new NewCtor({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: "https://openrouter.ai/api/v1",
      });
    }
    if (process.env.OPENAI_API_KEY) {
      return new NewCtor({ apiKey: process.env.OPENAI_API_KEY });
    }
  } catch (err) {
    console.error("[Glean] LLM client init failed:", err instanceof Error ? err.message : err);
  }
  return null;
}

/** Model to use: GLEAN_LLM_MODEL, or provider default (Groq/OpenRouter free models, or gpt-4o-mini). */
function getLLMModel(): string {
  if (process.env.GLEAN_LLM_MODEL) return process.env.GLEAN_LLM_MODEL;
  if (process.env.GROQ_API_KEY) return "llama-3.1-8b-instant";
  if (process.env.OPENROUTER_API_KEY) return "meta-llama/llama-3.2-3b-instruct:free";
  return "gpt-4o-mini";
}

/** Prior message for context (e.g. last N turns). */
export interface PriorMessage {
  role: "user" | "assistant";
  content?: string;
  type?: string;
}

/** Optional constraints for the agent (e.g. max price, preferred units). */
export interface InventoryConstraints {
  maxPricePerKg?: number;
  preferredUnits?: ("kg" | "lb" | "count" | "bunch")[];
  maxWeightKg?: number;
}

export interface GleanAgentRequest {
  prompt: string;
  role: "farmer" | "restaurant";
  priorMessages?: PriorMessage[];
  inventoryConstraints?: InventoryConstraints;
  /** When set (farmer), use Azure CV to fill title/item/description from this image, then merge with text for price, qty, delivery window. */
  imageId?: string;
  /** Required when imageId is set, for image ownership check. */
  userId?: string;
}

/** Draft listing fields (farmer). */
export interface DraftListing {
  title: string;
  item: string;
  description?: string;
  weightKg: number;
  pricePerKg: number;
  unit?: "kg" | "lb" | "count" | "bunch";
  /** Attach this image to the listing when posting (from chat upload). */
  imageId?: string;
  /** Optional delivery/availability window (from user text). */
  deliveryWindow?: { startAt: string; endAt: string };
}

/** Product suggestion item (restaurant) — matches ProductGridItem on frontend. */
export interface ProductSuggestionItem {
  id: string;
  listingId: string;
  title: string;
  item: string;
  description?: string;
  price: number;
  qty: number;
  unit?: string;
  farmerName: string;
  farmerId: string;
  imageId?: string;
  /** When the listing is available for delivery/pickup (optional). */
  deliveryWindow?: { startAt: string; endAt: string };
}

export type GleanAgentPayload =
  | { type: "inventory_form"; draft: DraftListing; userMessage?: string }
  | { type: "product_grid"; query: string; items: ProductSuggestionItem[] };

export interface GleanAgentResponse {
  introText: string;
  payload: GleanAgentPayload | null;
}

const MATCH_STOP_WORDS = new Set([
  "i", "need", "want", "looking", "for", "some", "by", "the", "a", "an",
  "kg", "lb", "and", "or", "to", "this", "week", "next", "please", "can", "you",
  "fresh", "delivery", "farmers", "find", "with", "from", "have", "get", "buy",
  "ordering", "bulk", "local", "organic", "ugly", "produce", "supply", "need",
]);

/** Extract produce item when user refers to a specific post (e.g. "the post is for melon", "for context, the post is for melon"). */
function extractReferencedProduce(prompt: string): string | null {
  const lower = prompt.toLowerCase().trim();
  const postForMatch = lower.match(/(?:post\s+is\s+for|for\s+context,?\s+the\s+post\s+is\s+for)\s+(\w+)/);
  if (postForMatch) return postForMatch[1].replace(/s$/, "");
  const theXOneMatch = lower.match(/(?:the|about the)\s+(\w+)\s+(?:one|post|listing)/);
  if (theXOneMatch) return theXOneMatch[1].replace(/s$/, "");
  return null;
}

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

function buildTextQuery(terms: string[]) {
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

/** Fetch real listings matching the prompt: restaurant → supply (from farmers), farmer → demand (from restaurants). */
async function fetchListingMatches(
  prompt: string,
  role: "farmer" | "restaurant",
  options?: { focusProduce?: string | null }
): Promise<ProductSuggestionItem[]> {
  const focus = options?.focusProduce?.trim();
  const terms = focus
    ? [focus.replace(/s$/, "")]
    : extractSearchTerms(prompt);
  const taxonomyTerms = await getProduceMatchTerms(terms);
  const matchTerms = taxonomyTerms.length > 0 ? taxonomyTerms : terms;
  const textQuery = buildTextQuery(matchTerms);

  const listingType = role === "farmer" ? "demand" : "supply";
  const creatorRole = role === "farmer" ? "restaurant" : "farmer";
  const defaultCreatorName = role === "farmer" ? "Restaurant" : "Farmer";

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

  return listings.map((doc) => {
    const createdBy = doc.createdBy as { _id: unknown; name?: string } | null;
    const photo = Array.isArray(doc.photos) && doc.photos.length > 0 ? doc.photos[0] : null;
    const dw = doc.deliveryWindow as { startAt?: Date; endAt?: Date } | undefined;
    return {
      id: String(doc._id),
      listingId: String(doc._id),
      title: doc.title ?? "",
      item: doc.item ?? "",
      description: doc.description ?? undefined,
      price: doc.price ?? 0,
      qty: doc.qty ?? 0,
      unit: doc.unit ?? "kg",
      farmerName: createdBy?.name ?? defaultCreatorName,
      farmerId: createdBy?._id != null ? String(createdBy._id) : "",
      imageId: photo?.imageId != null ? String(photo.imageId) : undefined,
      deliveryWindow:
        dw?.startAt && dw?.endAt
          ? {
              startAt: typeof dw.startAt === "string" ? dw.startAt : (dw.startAt as Date).toISOString(),
              endAt: typeof dw.endAt === "string" ? dw.endAt : (dw.endAt as Date).toISOString(),
            }
          : undefined,
    };
  });
}

const FARMER_EXTRACT_FROM_TEXT_SYSTEM = `You are a Glean assistant. The user is creating a listing and we already have title, item, and description from their uploaded image. From their message extract ONLY: price per kg (number), weight/quantity in kg (number), unit (kg/lb/count/bunch), and if they mention when they are available for delivery or pickup, output a delivery window as two ISO 8601 date-time strings (startAt, endAt). Use the next occurrence of the mentioned day/time if relative (e.g. "Friday 9am-5pm" = this or next Friday; "delivered from 10 to 12:00 p.m. on Sunday" = next Sunday 10:00 and 12:00 in local time). Always include deliveryWindow with valid startAt and endAt whenever the user mentions a time window (e.g. "10 to 12", "10-12", "from X to Y on Sunday"). Reply with exactly one JSON object (no markdown): { "pricePerKg": number or null, "weightKg": number or null, "unit": "kg"|"lb"|"count"|"bunch" or null, "deliveryWindow": { "startAt": "ISO8601", "endAt": "ISO8601" } or null }. Omit deliveryWindow only if no time/delivery window is mentioned.`;

const FARMER_SYSTEM = `You are a Glean assistant helping farmers list their produce. Prices are based on daily Toronto wholesale market data from Agriculture and Agri-Food Canada (AAFC Infohort). From the user's message, extract a draft listing. Respond with exactly one JSON object (no markdown, no code block) with this shape:
{
  "introText": "One short sentence to show the user (e.g. 'Here's your draft based on today's Toronto wholesale prices. Confirm weight and price, then tap Post to list it.')",
  "draft": {
    "title": "Short listing title (e.g. 'Fresh tomatoes — 20kg')",
    "item": "Produce type in singular (e.g. tomato, carrot)",
    "description": "Optional 1-2 sentence description or empty string",
    "weightKg": number (numeric only, e.g. 20),
    "pricePerKg": number (e.g. 3.5),
    "unit": "kg" or "lb" or "count" or "bunch",
    "deliveryWindow": { "startAt": "ISO 8601 date-time", "endAt": "ISO 8601 date-time" } or null — whenever the user mentions a delivery or availability time (e.g. "delivered from 10 to 12:00 p.m. on Sunday" or "Sunday 10 to 12 PM" → next Sunday 10:00 and 12:00 in local time as ISO strings; "10-12 on Friday" → next Friday 10:00 and 12:00)
  }
}
If the user did not specify weight or price, use sensible defaults (e.g. weightKg 20, pricePerKg 3.5). Always set deliveryWindow with valid startAt and endAt ISO strings when the user mentions any time range for delivery or availability; omit only if no time is mentioned.`;

const RESTAURANT_INTRO_SYSTEM = `You are a Glean assistant. A restaurant asked for produce and we found matching listings. Generate exactly one short, friendly intro sentence that mentions the number of matches. Vary your wording — use different phrasings, don't always end with the same line.

Good examples (vary like these):
- "We found 3 matching produce orders for your restaurant. Take a look."
- "Here are 2 matching listings from our network. Let's connect you with the best fit!"
- "We have 1 listing that matches what you're looking for. Check it out below."

Reply with a JSON object only: { "introText": "your sentence here" }. No other text. Do not repeat the same phrase every time; vary the intro.`;

const RESTAURANT_ANSWER_FROM_LISTING_SYSTEM = `You are a Glean assistant. The user asked a follow-up question about a specific listing. Use ONLY the listing title and description below to answer their question in one short sentence. If the listing says "contact for delivery" or similar, say that. Reply with a JSON object only: { "introText": "your one-sentence answer here" }. No other text.`;

/** Fallback draft when LLM is unavailable (farmer). */
function fallbackDraftFromPrompt(prompt: string): { introText: string; draft: DraftListing } {
  const lower = prompt.toLowerCase();
  const weightMatch = prompt.match(/(\d+)\s*(kg|lb)?/i);
  const weight = weightMatch ? Number(weightMatch[1]) : 20;
  const unit = (weightMatch?.[2]?.toLowerCase() as "kg" | "lb") || "kg";
  const itemMatch = lower.match(/(carrots?|tomatoes?|potatoes?|onions?|lettuce|apples?|beets?|ugly|organic)/);
  const item = itemMatch ? (itemMatch[1] === "ugly" ? "carrots" : itemMatch[1]) : "produce";
  const itemSingular = item.replace(/s$/, "");
  return {
    introText: "Here's your draft based on Toronto wholesale market prices. Confirm weight and price, then tap Post to list it.",
    draft: {
      title: `Fresh ${item} — ${weight}${unit}`,
      item: itemSingular,
      description: prompt.slice(0, 200) || undefined,
      weightKg: unit === "lb" ? weight * 0.453592 : weight,
      pricePerKg: 3.5,
      unit: unit === "lb" ? "lb" : "kg",
    },
  };
}

/** Detect if the user wants to create/post a new listing (not search for existing ones). */
function hasCreateListingIntent(prompt: string): boolean {
  const lower = prompt.toLowerCase().trim();
  const createPatterns = [
    /\bcreate\s+(a\s+)?(new\s+)?listing\b/,
    /\b(?:i\s+)?(?:want\s+to\s+)?create\s+(?:a\s+)?(?:new\s+)?listing\b/,
    /\b(?:i\s+)?(?:want\s+to\s+)?list\s+(?:my\s+)?/,
    /\blist\s+my\s+(?:harvest|produce)/,
    /\bpost\s+(?:a\s+)?(?:new\s+)?listing\b/,
    /\b(?:add|put)\s+(?:up\s+)?(?:a\s+)?listing\b/,
    /\b(?:i\s+)?(?:want\s+to\s+)?(?:list|post)\s+\d+\s*(kg|lb)/,  // e.g. "list 100 kg"
    /\b(?:list|sell)\s+\d+/,
  ];
  return createPatterns.some((re) => re.test(lower));
}

/**
 * Run the Glean agent: LLM + optional listing search.
 * Returns intro text and structured payload (product_grid or inventory_form).
 * When the user clearly asks to "create a new listing", we return a draft (inventory_form) even for restaurant role.
 */
export async function runGleanAgent(req: GleanAgentRequest): Promise<GleanAgentResponse> {
  const { prompt, role, priorMessages = [], inventoryConstraints } = req;
  const trimmed = prompt.trim();
  if (!trimmed) {
    return { introText: "", payload: null };
  }

  const client = getLLMClient();
  if (!client && (process.env.NODE_ENV !== "production" || process.env.GLEAN_LLM_DEBUG)) {
    console.warn("[Glean] No LLM client: set GROQ_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY in .env and restart the server.");
  }

  // If the user clearly wants to create a listing, run the draft flow regardless of role (don't search).
  const useDraftFlow = role === "farmer" || hasCreateListingIntent(trimmed);

  if (role === "restaurant" && !useDraftFlow) {
    const referencedProduce = extractReferencedProduce(trimmed);
    const items = await fetchListingMatches(trimmed, role, {
      focusProduce: referencedProduce ?? undefined,
    });
    const count = items.length;
    let introText = count === 0
      ? "No matching listings right now. Try a different search."
      : count === 1
        ? "We found 1 matching listing from our network. Take a look."
        : `We found ${count} matching listings from our network. Take a look.`;
    if (client && count > 0) {
      try {
        const lastUser = priorMessages.filter((m) => m.role === "user").slice(-1)[0];
        const userContent = lastUser?.content ?? trimmed;
        const isFollowUpQuestion = /(\?|delivery|when|how|what'?s|which|tell me)/i.test(trimmed) && count === 1;
        const singleListing = count === 1 ? items[0] : null;

        if (isFollowUpQuestion && singleListing) {
          const listingSummary = `Title: ${singleListing.title}. Item: ${singleListing.item}. Description: ${singleListing.description ?? "No description."}`;
          const res = await client.chat.completions.create({
            model: getLLMModel(),
            messages: [
              { role: "system", content: RESTAURANT_ANSWER_FROM_LISTING_SYSTEM },
              { role: "user", content: `Listing: ${listingSummary}\n\nUser asked: "${userContent}"\n\nAnswer their question in one short sentence using only the listing info above.` },
            ],
            response_format: { type: "json_object" },
            max_tokens: 120,
          });
          const raw = res.choices[0]?.message?.content;
          if (raw) {
            const parsed = JSON.parse(raw) as { introText?: string };
            if (typeof parsed.introText === "string" && parsed.introText.trim()) {
              introText = parsed.introText.trim();
            }
          }
        } else {
          const res = await client.chat.completions.create({
            model: getLLMModel(),
            messages: [
              { role: "system", content: RESTAURANT_INTRO_SYSTEM },
              { role: "user", content: `Restaurant asked: "${userContent}". We found ${count} matching listing${count === 1 ? "" : "s"}. Write one short intro sentence that includes the number (${count}) and optionally what they asked for. Vary the phrasing.` },
            ],
            response_format: { type: "json_object" },
            max_tokens: 150,
          });
          const raw = res.choices[0]?.message?.content;
          if (raw) {
            const parsed = JSON.parse(raw) as { introText?: string };
            if (typeof parsed.introText === "string" && parsed.introText.trim()) {
              introText = parsed.introText.trim();
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const status = err && typeof (err as { status?: number }).status === "number" ? (err as { status: number }).status : "";
        console.error("[Glean] LLM intro failed, using default:", status ? `${msg} (HTTP ${status})` : msg);
      }
    }
    return {
      introText,
      payload: { type: "product_grid", query: trimmed, items },
    };
  }

  // Farmer with image: Azure CV draft + merge text (price, qty, delivery window)
  if (role === "farmer" && req.imageId && req.userId) {
    let imageFields: Awaited<ReturnType<typeof getDraftSuggestedFieldsFromImage>> | null = null;
    try {
      imageFields = await getDraftSuggestedFieldsFromImage(req.imageId, req.userId);
    } catch {
      // 404/403 or vision failure: fall through to text-only draft
    }
    if (imageFields && client) {
      try {
        const res = await client.chat.completions.create({
          model: getLLMModel(),
          messages: [
            { role: "system", content: FARMER_EXTRACT_FROM_TEXT_SYSTEM },
            { role: "user", content: trimmed },
          ],
          response_format: { type: "json_object" },
          max_tokens: 200,
        });
        const raw = res.choices[0]?.message?.content;
        if (raw) {
          const parsed = JSON.parse(raw) as {
            pricePerKg?: number | null;
            weightKg?: number | null;
            unit?: string | null;
            deliveryWindow?: { startAt?: string; endAt?: string } | null;
          };
          const weightKg = Number(parsed.weightKg) || 20;
          const pricePerKg = Number(parsed.pricePerKg) ?? imageFields.suggestedPricePerKg ?? 2.5;
          const unit = ["kg", "lb", "count", "bunch"].includes(parsed.unit as string) ? parsed.unit : (imageFields.suggestedUnit ?? "kg");
          const deliveryWindow =
            parsed.deliveryWindow?.startAt && parsed.deliveryWindow?.endAt
              ? { startAt: parsed.deliveryWindow.startAt, endAt: parsed.deliveryWindow.endAt }
              : undefined;
          const draft: DraftListing = {
            title: imageFields.title,
            item: imageFields.item,
            description: imageFields.description,
            weightKg,
            pricePerKg,
            unit: unit as "kg" | "lb" | "count" | "bunch",
            imageId: req.imageId,
            deliveryWindow,
          };
          return {
            introText: "Here's your draft from the photo and your message. Price is based on today's Toronto wholesale market data. Confirm weight and price, then tap Post.",
            payload: { type: "inventory_form", draft, userMessage: trimmed },
          };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[Glean] Extract-from-text (with image) failed:", msg);
      }
      // LLM extract failed: still return draft from image with defaults
      const draft: DraftListing = {
        title: imageFields.title,
        item: imageFields.item,
        description: imageFields.description,
        weightKg: 20,
        pricePerKg: imageFields.suggestedPricePerKg ?? 3.5,
        unit: (imageFields.suggestedUnit as "kg" | "lb" | "count" | "bunch") ?? "kg",
        imageId: req.imageId,
      };
      return {
        introText: "Here's your draft from the photo. Price is based on Toronto wholesale data. Fill in weight and delivery window, then tap Post.",
        payload: { type: "inventory_form", draft, userMessage: trimmed },
      };
    }
    if (imageFields && !client) {
      const draft: DraftListing = {
        title: imageFields.title,
        item: imageFields.item,
        description: imageFields.description,
        weightKg: 20,
        pricePerKg: imageFields.suggestedPricePerKg ?? 3.5,
        unit: (imageFields.suggestedUnit as "kg" | "lb" | "count" | "bunch") ?? "kg",
        imageId: req.imageId,
      };
      return {
        introText: "Here's your draft from the photo. Price is based on Toronto wholesale data. Fill in weight and delivery window, then tap Post.",
        payload: { type: "inventory_form", draft, userMessage: trimmed },
      };
    }
  }

  // Farmer: LLM to extract draft
  if (client) {
    try {
      const context = priorMessages.length > 0
        ? `Previous messages (for context):\n${priorMessages.map((m) => `${m.role}: ${m.content ?? ""}`).join("\n")}\n\nCurrent user message:`
        : "User message:";
      const res = await client.chat.completions.create({
        model: getLLMModel(),
        messages: [
          { role: "system", content: FARMER_SYSTEM },
          { role: "user", content: `${context}\n${trimmed}` },
        ],
        response_format: { type: "json_object" },
        max_tokens: 400,
      });
      const raw = res.choices[0]?.message?.content;
      if (raw) {
        const parsed = JSON.parse(raw) as { introText?: string; draft?: DraftListing & { deliveryWindow?: { startAt?: string; endAt?: string } | null } };
        if (parsed.draft && typeof parsed.draft === "object") {
          const d = parsed.draft;
          const deliveryWindow =
            d.deliveryWindow?.startAt && d.deliveryWindow?.endAt
              ? { startAt: d.deliveryWindow.startAt, endAt: d.deliveryWindow.endAt }
              : undefined;
          const draft: DraftListing = {
            title: String(d.title ?? "").slice(0, 150) || "Fresh produce",
            item: String(d.item ?? "produce").slice(0, 100),
            description: d.description != null ? String(d.description).slice(0, 500) : undefined,
            weightKg: Number(d.weightKg) || 20,
            pricePerKg: Number(d.pricePerKg) || 2.5,
            unit: ["kg", "lb", "count", "bunch"].includes(d.unit as string) ? d.unit : "kg",
            ...(deliveryWindow && { deliveryWindow }),
          };
          const baseIntro =
            typeof parsed.introText === "string" ? parsed.introText.trim() : "Here's your draft. Confirm weight and price, then tap Post to list it.";
          const introText = draft.imageId
            ? baseIntro
            : `${baseIntro} Consider adding a photo to your listing for better visibility.`;
          return {
            introText,
            payload: { type: "inventory_form", draft, userMessage: trimmed },
          };
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = err && typeof (err as { status?: number }).status === "number" ? (err as { status: number }).status : "";
      console.error("[Glean] LLM draft failed, using fallback:", status ? `${msg} (HTTP ${status})` : msg);
    }
  }

  const fallback = fallbackDraftFromPrompt(trimmed);
  const fallbackIntro = fallback.draft.imageId
    ? fallback.introText
    : `${fallback.introText} Consider adding a photo for better visibility.`;
  return {
    introText: fallbackIntro,
    payload: { type: "inventory_form", draft: fallback.draft, userMessage: trimmed },
  };
}
