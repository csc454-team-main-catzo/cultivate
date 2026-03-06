/**
 * Glean agent API: match user prompt to real listings (e.g. restaurant "need 50kg carrots" → supply listings).
 * Uses produce taxonomy so "tomato" matches listings with type tomato (Roma, cherry, etc.) from farmers.
 */

import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import type { AuthenticatedContext } from "../middleware/types.js";
import Listing from "../models/Listing.js";
import { getProduceMatchTerms } from "../services/produceMatcher.js";

const agent = new Hono<AuthenticatedContext>();

/** Words we never use for matching — generic/filler so we prioritize actual produce (e.g. "tomatoes" not "fresh"). */
const STOP_WORDS = new Set([
  "i", "need", "want", "looking", "for", "some", "by", "the", "a", "an",
  "kg", "lb", "and", "or", "to", "this", "week", "next", "please", "can", "you",
  "fresh", "delivery", "farmers", "find", "with", "from", "have", "get", "buy",
  "ordering", "bulk", "local", "organic", "ugly", "produce", "supply", "need",
]);

/** Extract search terms from prompt; excludes stopwords so produce type is prioritized (e.g. "fresh tomatoes" → ["tomato"]). */
function extractSearchTerms(prompt: string): string[] {
  const lower = prompt.toLowerCase().trim();
  const words = lower.replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
  const terms: string[] = [];
  for (const w of words) {
    if (w.length >= 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w)) {
      terms.push(w.replace(/s$/, "")); // singular
    }
  }
  return terms.length > 0 ? terms : ["produce"];
}

/** Build MongoDB $or for item/title/description matching any of the terms (regex, case-insensitive). */
function buildTextQuery(terms: string[]) {
  if (terms.length === 0) return {};
  const escaped = terms.map((t) =>
    t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  const regexes = escaped.map((e) => new RegExp(e, "i"));
  return {
    $or: [
      ...regexes.flatMap((r) => [
        { item: r },
        { title: r },
        { description: r },
      ]),
    ],
  };
}

/** POST /glean/match — body: { prompt, role }. Returns real listing matches for restaurant; farmer unchanged. */
agent.post(
  "/glean/match",
  authMiddleware({ optional: true }),
  async (c) => {
    try {
      const body = (await c.req.json()) as { prompt?: string; role?: string };
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      const role = body.role === "farmer" || body.role === "restaurant" ? body.role : "restaurant";

      if (!prompt) {
        return c.json({ error: "prompt is required" }, 400);
      }

      if (role === "farmer") {
        // Farmer flow: draft suggestion could be added later; for now return empty matches.
        return c.json({ query: prompt, items: [], role: "farmer" });
      }

      const terms = extractSearchTerms(prompt);
      // Prefer taxonomy: "tomato" → match listings with produce type tomato (Roma, cherry, etc.), not exact keyword
      const taxonomyTerms = await getProduceMatchTerms(terms);
      const matchTerms = taxonomyTerms.length > 0 ? taxonomyTerms : terms;
      const textQuery = buildTextQuery(matchTerms);
      // Only supply listings (from farmers)
      let listings = await Listing.find({
        type: "supply",
        status: "open",
        ...textQuery,
      })
        .populate("createdBy", "name email role")
        .sort({ createdAt: -1 })
        .limit(30)
        .lean();

      // Only from farmer-type users
      listings = listings.filter(
        (doc) => (doc.createdBy as { role?: string } | null)?.role === "farmer"
      ).slice(0, 20);

      if (listings.length === 0) {
        listings = await Listing.find({ type: "supply", status: "open" })
          .populate("createdBy", "name email role")
          .sort({ createdAt: -1 })
          .limit(30)
          .lean();
        listings = listings.filter(
          (doc) => (doc.createdBy as { role?: string } | null)?.role === "farmer"
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
          farmerName: createdBy?.name ?? "Farmer",
          farmerId: createdBy?._id != null ? String(createdBy._id) : "",
          imageId: photo?.imageId != null ? String(photo.imageId) : undefined,
        };
      });

      return c.json({ query: prompt, items, role: "restaurant" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);

export default agent;
