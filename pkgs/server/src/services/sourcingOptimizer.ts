/**
 * Sourcing Optimizer: LLM-powered order fulfillment optimization.
 *
 * Given a restaurant's order (structured or natural language), this service:
 * 1. Parses order intent via LLM when needed
 * 2. Discovers matching supply listings (exact + substitutes via taxonomy + LLM clustering)
 * 3. Scores candidates on availability, price, timing, and product match
 * 4. Generates ranked fulfillment strategies (single-source, multi-source, partial-fill)
 * 5. Returns a transparent sourcing plan with explanations
 */

import OpenAIModule from "openai";
import Listing from "../models/Listing.js";
import { getProduceMatchTerms } from "./produceMatcher.js";

// ---------------------------------------------------------------------------
// LLM client (reuses same provider-priority logic as gleanAgent)
// ---------------------------------------------------------------------------

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

function getOpenAIConstructor(): new (opts: { apiKey: string; baseURL?: string }) => LLMClient {
  const M = OpenAIModule as unknown as
    | (new (opts: { apiKey: string; baseURL?: string }) => LLMClient)
    | { default?: new (opts: { apiKey: string; baseURL?: string }) => LLMClient; OpenAI?: new (opts: { apiKey: string; baseURL?: string }) => LLMClient };
  const Ctor = (typeof M === "function" ? M : M?.default ?? (M as { OpenAI?: unknown }).OpenAI ?? M) as new (opts: { apiKey: string; baseURL?: string }) => LLMClient;
  if (typeof Ctor !== "function") throw new Error("[Optimizer] OpenAI SDK: expected constructor");
  return Ctor;
}

function getLLMClient(): LLMClient | null {
  try {
    const C = getOpenAIConstructor();
    if (process.env.GROQ_API_KEY) return new C({ apiKey: process.env.GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1" });
    if (process.env.OPENROUTER_API_KEY) return new C({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1" });
    if (process.env.OPENAI_API_KEY) return new C({ apiKey: process.env.OPENAI_API_KEY });
  } catch (err) {
    console.error("[Optimizer] LLM client init failed:", err instanceof Error ? err.message : err);
  }
  return null;
}

function getLLMModel(): string {
  if (process.env.GLEAN_LLM_MODEL) return process.env.GLEAN_LLM_MODEL;
  if (process.env.GROQ_API_KEY) return "llama-3.1-8b-instant";
  if (process.env.OPENROUTER_API_KEY) return "meta-llama/llama-3.2-3b-instruct:free";
  return "gpt-4o-mini";
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OrderLineItem {
  item: string;
  qtyNeeded: number;
  unit: string;
  maxPricePerUnit?: number;
  acceptSubstitutes?: boolean;
  notes?: string;
}

export interface OptimizationConstraints {
  maxTotalBudget?: number;
  preferredDeliveryWindow?: { startAt: string; endAt: string };
  maxSuppliers?: number;
  prioritize?: "cost" | "speed" | "quality" | "coverage";
}

export interface OptimizationRequest {
  orderDescription?: string;
  lineItems?: OrderLineItem[];
  constraints?: OptimizationConstraints;
}

export interface SupplierCandidate {
  listingId: string;
  supplierId: string;
  supplierName: string;
  item: string;
  title: string;
  description?: string;
  availableQty: number;
  unit: string;
  pricePerUnit: number;
  deliveryWindow?: { startAt: string; endAt: string };
  imageId?: string;
  matchType: "exact" | "substitute" | "cluster";
  matchScore: number;
  matchReason: string;
}

export interface FulfillmentAllocation {
  lineItemIndex: number;
  lineItemName: string;
  supplier: {
    listingId: string;
    supplierId: string;
    supplierName: string;
    item: string;
    title: string;
    pricePerUnit: number;
    imageId?: string;
  };
  allocatedQty: number;
  unit: string;
  subtotal: number;
  matchType: "exact" | "substitute" | "cluster";
  matchScore: number;
  deliveryWindow?: { startAt: string; endAt: string };
}

export interface StrategyMetrics {
  totalCost: number;
  supplierCount: number;
  coveragePercent: number;
  avgMatchScore: number;
  estimatedDelivery?: string;
}

export interface FulfillmentStrategy {
  id: string;
  name: string;
  description: string;
  allocations: FulfillmentAllocation[];
  metrics: StrategyMetrics;
  tradeoffs: string[];
  rank: number;
}

export interface UnfulfillableItem {
  lineItemIndex: number;
  lineItemName: string;
  qtyNeeded: number;
  qtyAvailable: number;
  reason: string;
}

export interface SourcingPlan {
  orderId: string;
  lineItems: OrderLineItem[];
  candidates: SupplierCandidate[];
  strategies: FulfillmentStrategy[];
  strategyOptions: Array<{
    strategyId: string;
    name: string;
    description: string;
    rank: number;
    metrics: StrategyMetrics;
    tradeoffs: string[];
  }>;
  recommendedStrategyId: string | null;
  unfulfillable: UnfulfillableItem[];
  summary: string;
  reasoning: string;
}

// ---------------------------------------------------------------------------
// LLM prompts
// ---------------------------------------------------------------------------

const PARSE_ORDER_SYSTEM = `You are a sourcing assistant for a farm-to-table marketplace. Parse the user's natural-language order into structured line items. Respond with exactly one JSON object (no markdown):
{
  "lineItems": [
    {
      "item": "produce name in singular (e.g. tomato, carrot)",
      "qtyNeeded": number,
      "unit": "kg" | "lb" | "count" | "bunch",
      "maxPricePerUnit": number or null,
      "acceptSubstitutes": true/false,
      "notes": "any special requirements or empty string"
    }
  ]
}
If the user mentions budget or delivery constraints, include them but still output the above shape. Infer reasonable quantities if not stated explicitly (e.g. "some tomatoes" → 10 kg). Always use singular item names.`;

const MATCH_SCORING_SYSTEM = `You are a produce matching expert. Given an order item and a list of available supplier listings, score each supplier on product match quality. Consider:
- Exact product matches score 1.0
- Same-family substitutes (e.g. Roma tomato for tomato) score 0.7-0.9
- Related products that could substitute (e.g. arugula for spinach) score 0.4-0.6
- Poor matches score below 0.3

Respond with exactly one JSON object (no markdown):
{
  "scores": [
    {
      "listingId": "the listing ID",
      "matchType": "exact" | "substitute" | "cluster",
      "matchScore": number between 0 and 1,
      "matchReason": "brief explanation of why this is/isn't a good match"
    }
  ]
}`;

const EXPLAIN_PLAN_SYSTEM = `You are a sourcing advisor for a farm-to-table marketplace. Given a sourcing plan with multiple fulfillment strategies, write:
1. A concise summary (2-3 sentences) of the recommended approach
2. A reasoning section (3-5 sentences) explaining why the top strategy was selected, what trade-offs exist, and any caveats

Respond with exactly one JSON object (no markdown):
{
  "summary": "your summary here",
  "reasoning": "your detailed reasoning here"
}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateStrategyId(): string {
  return `strat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeUnit(unit: string): string {
  const u = unit.toLowerCase().trim();
  if (["kg", "kgs", "kilogram", "kilograms"].includes(u)) return "kg";
  if (["lb", "lbs", "pound", "pounds"].includes(u)) return "lb";
  if (["count", "pc", "pcs", "piece", "pieces", "each"].includes(u)) return "count";
  if (["bunch", "bunches"].includes(u)) return "bunch";
  return "kg";
}

function convertToBaseUnit(qty: number, fromUnit: string, toUnit: string): number {
  if (fromUnit === toUnit) return qty;
  if (fromUnit === "lb" && toUnit === "kg") return qty * 0.453592;
  if (fromUnit === "kg" && toUnit === "lb") return qty / 0.453592;
  return qty;
}

function deliveryOverlap(
  preferred: { startAt: string; endAt: string } | undefined,
  available: { startAt: string; endAt: string } | undefined
): number {
  if (!preferred || !available) return 0.5;
  const pStart = new Date(preferred.startAt).getTime();
  const pEnd = new Date(preferred.endAt).getTime();
  const aStart = new Date(available.startAt).getTime();
  const aEnd = new Date(available.endAt).getTime();
  if (isNaN(pStart) || isNaN(pEnd) || isNaN(aStart) || isNaN(aEnd)) return 0.5;
  const overlapStart = Math.max(pStart, aStart);
  const overlapEnd = Math.min(pEnd, aEnd);
  if (overlapStart >= overlapEnd) return 0;
  const overlapMs = overlapEnd - overlapStart;
  const preferredMs = pEnd - pStart;
  return preferredMs > 0 ? Math.min(overlapMs / preferredMs, 1) : 0.5;
}

const STOP_WORDS = new Set([
  "i", "need", "want", "looking", "for", "some", "by", "the", "a", "an",
  "kg", "lb", "and", "or", "to", "this", "week", "next", "please", "can", "you",
  "fresh", "delivery", "farmers", "find", "with", "from", "have", "get", "buy",
  "ordering", "bulk", "local", "organic", "produce", "supply",
]);

function extractSearchTerms(text: string): string[] {
  const words = text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
  return words
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w))
    .map((w) => w.replace(/s$/, ""));
}

function buildTextQuery(terms: string[]) {
  if (terms.length === 0) return {};
  const regexes = terms.map((t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  return { $or: regexes.flatMap((r) => [{ item: r }, { title: r }, { description: r }]) };
}

// ---------------------------------------------------------------------------
// Phase 1: Parse order via LLM (if natural language)
// ---------------------------------------------------------------------------

async function parseOrderWithLLM(client: LLMClient, description: string): Promise<OrderLineItem[]> {
  try {
    const res = await client.chat.completions.create({
      model: getLLMModel(),
      messages: [
        { role: "system", content: PARSE_ORDER_SYSTEM },
        { role: "user", content: description },
      ],
      response_format: { type: "json_object" },
      max_tokens: 600,
    });
    const raw = res.choices[0]?.message?.content;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { lineItems?: Array<Record<string, unknown>> };
    if (!Array.isArray(parsed.lineItems)) return [];
    return parsed.lineItems.map((li) => ({
      item: String(li.item ?? "produce"),
      qtyNeeded: Math.max(1, Number(li.qtyNeeded) || 10),
      unit: normalizeUnit(String(li.unit ?? "kg")),
      maxPricePerUnit: li.maxPricePerUnit != null ? Number(li.maxPricePerUnit) : undefined,
      acceptSubstitutes: li.acceptSubstitutes !== false,
      notes: li.notes ? String(li.notes) : undefined,
    }));
  } catch (err) {
    console.error("[Optimizer] LLM order parse failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

function parseOrderFallback(description: string): OrderLineItem[] {
  const terms = extractSearchTerms(description);
  const qtyMatch = description.match(/(\d+)\s*(kg|lb|count|bunch)?/i);
  const qty = qtyMatch ? Number(qtyMatch[1]) : 20;
  const unit = normalizeUnit(qtyMatch?.[2] ?? "kg");
  if (terms.length === 0) return [{ item: "produce", qtyNeeded: qty, unit, acceptSubstitutes: true }];
  return terms.slice(0, 5).map((t) => ({
    item: t,
    qtyNeeded: qty,
    unit,
    acceptSubstitutes: true,
  }));
}

// ---------------------------------------------------------------------------
// Phase 2: Discover candidate suppliers
// ---------------------------------------------------------------------------

interface RawListing {
  _id: unknown;
  title: string;
  item: string;
  description?: string;
  price: number;
  qty: number;
  unit: string;
  photos?: Array<{ imageId?: string }>;
  deliveryWindow?: { startAt?: Date | string; endAt?: Date | string };
  createdBy: { _id: unknown; name?: string; role?: string } | null;
}

async function discoverCandidates(lineItems: OrderLineItem[]): Promise<Map<number, RawListing[]>> {
  const result = new Map<number, RawListing[]>();

  for (let i = 0; i < lineItems.length; i++) {
    const li = lineItems[i];
    const baseTerms = extractSearchTerms(li.item);
    const taxonomyTerms = await getProduceMatchTerms(baseTerms.length > 0 ? baseTerms : [li.item]);
    const allTerms = [...new Set([...taxonomyTerms, ...baseTerms, li.item.toLowerCase().replace(/s$/, "")])];
    const textQuery = buildTextQuery(allTerms);

    let listings = await Listing.find({ type: "supply", status: "open", ...textQuery })
      .populate("createdBy", "name email role")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    listings = listings.filter(
      (doc) => (doc.createdBy as { role?: string } | null)?.role === "farmer"
    );

    if (listings.length === 0 && li.acceptSubstitutes) {
      listings = await Listing.find({ type: "supply", status: "open" })
        .populate("createdBy", "name email role")
        .sort({ createdAt: -1 })
        .limit(30)
        .lean();
      listings = listings.filter(
        (doc) => (doc.createdBy as { role?: string } | null)?.role === "farmer"
      );
    }

    result.set(i, listings as unknown as RawListing[]);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Phase 3: Score candidates (taxonomy + optional LLM)
// ---------------------------------------------------------------------------

function taxonomyMatchScore(orderItem: string, listingItem: string): { score: number; type: "exact" | "substitute" | "cluster" } {
  const a = orderItem.toLowerCase().replace(/s$/, "").trim();
  const b = listingItem.toLowerCase().replace(/s$/, "").trim();
  if (a === b) return { score: 1.0, type: "exact" };
  if (b.includes(a) || a.includes(b)) return { score: 0.85, type: "exact" };

  const aTokens = new Set(a.split(/\s+/));
  const bTokens = new Set(b.split(/\s+/));
  let overlap = 0;
  for (const t of aTokens) { if (bTokens.has(t)) overlap++; }
  if (overlap > 0) return { score: 0.6 + overlap * 0.1, type: "substitute" };
  return { score: 0.2, type: "cluster" };
}

async function scoreCandidatesWithLLM(
  client: LLMClient,
  lineItem: OrderLineItem,
  listings: RawListing[]
): Promise<Map<string, { matchScore: number; matchType: "exact" | "substitute" | "cluster"; matchReason: string }>> {
  const scores = new Map<string, { matchScore: number; matchType: "exact" | "substitute" | "cluster"; matchReason: string }>();

  if (listings.length === 0) return scores;

  const listingSummaries = listings.slice(0, 15).map((l) => ({
    listingId: String(l._id),
    item: l.item,
    title: l.title,
    description: (l.description ?? "").slice(0, 80),
  }));

  try {
    const res = await client.chat.completions.create({
      model: getLLMModel(),
      messages: [
        { role: "system", content: MATCH_SCORING_SYSTEM },
        {
          role: "user",
          content: `Order item: "${lineItem.item}" (${lineItem.qtyNeeded} ${lineItem.unit})${lineItem.notes ? `. Notes: ${lineItem.notes}` : ""}\n\nAvailable listings:\n${JSON.stringify(listingSummaries, null, 1)}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 800,
    });
    const raw = res.choices[0]?.message?.content;
    if (raw) {
      const parsed = JSON.parse(raw) as {
        scores?: Array<{ listingId?: string; matchScore?: number; matchType?: string; matchReason?: string }>;
      };
      for (const s of parsed.scores ?? []) {
        if (!s.listingId) continue;
        const mt = (["exact", "substitute", "cluster"].includes(s.matchType ?? "") ? s.matchType : "cluster") as "exact" | "substitute" | "cluster";
        scores.set(s.listingId, {
          matchScore: Math.min(1, Math.max(0, Number(s.matchScore) || 0)),
          matchType: mt,
          matchReason: String(s.matchReason ?? ""),
        });
      }
    }
  } catch (err) {
    console.error("[Optimizer] LLM scoring failed, using taxonomy fallback:", err instanceof Error ? err.message : err);
  }

  return scores;
}

function buildCandidates(
  lineItemIndex: number,
  lineItem: OrderLineItem,
  listings: RawListing[],
  llmScores: Map<string, { matchScore: number; matchType: "exact" | "substitute" | "cluster"; matchReason: string }>
): SupplierCandidate[] {
  return listings.map((doc) => {
    const id = String(doc._id);
    const llm = llmScores.get(id);
    const tax = taxonomyMatchScore(lineItem.item, doc.item);
    const matchScore = llm ? llm.matchScore : tax.score;
    const matchType = llm ? llm.matchType : tax.type;
    const matchReason = llm?.matchReason ?? `Taxonomy match: ${tax.type} (${(tax.score * 100).toFixed(0)}%)`;

    const createdBy = doc.createdBy;
    const photo = Array.isArray(doc.photos) && doc.photos.length > 0 ? doc.photos[0] : null;
    const dw = doc.deliveryWindow;

    return {
      listingId: id,
      supplierId: createdBy?._id != null ? String(createdBy._id) : "",
      supplierName: createdBy?.name ?? "Farmer",
      item: doc.item ?? "",
      title: doc.title ?? "",
      description: doc.description,
      availableQty: doc.qty ?? 0,
      unit: doc.unit ?? "kg",
      pricePerUnit: doc.price ?? 0,
      deliveryWindow:
        dw?.startAt && dw?.endAt
          ? {
              startAt: typeof dw.startAt === "string" ? dw.startAt : (dw.startAt as Date).toISOString(),
              endAt: typeof dw.endAt === "string" ? dw.endAt : (dw.endAt as Date).toISOString(),
            }
          : undefined,
      imageId: photo?.imageId != null ? String(photo.imageId) : undefined,
      matchType,
      matchScore,
      matchReason,
    };
  });
}

// ---------------------------------------------------------------------------
// Phase 4: Strategy generation
// ---------------------------------------------------------------------------

interface CandidatePool {
  lineItemIndex: number;
  lineItem: OrderLineItem;
  candidates: SupplierCandidate[];
}

function allocateGreedy(
  pools: CandidatePool[],
  sortKey: (c: SupplierCandidate) => number,
  constraints?: OptimizationConstraints
): { allocations: FulfillmentAllocation[]; unfulfillable: UnfulfillableItem[] } {
  const allocations: FulfillmentAllocation[] = [];
  const unfulfillable: UnfulfillableItem[] = [];
  const supplierRemaining = new Map<string, number>();
  let totalCost = 0;

  for (const pool of pools) {
    const sorted = [...pool.candidates]
      .filter((c) => c.matchScore >= 0.2)
      .sort((a, b) => sortKey(b) - sortKey(a));

    let remaining = pool.lineItem.qtyNeeded;
    let totalAvailable = 0;

    for (const candidate of sorted) {
      if (remaining <= 0) break;
      if (constraints?.maxTotalBudget && totalCost >= constraints.maxTotalBudget) break;

      const alreadyAllocated = pool.lineItem.qtyNeeded - remaining;
      const supplierLeft = (supplierRemaining.get(candidate.listingId) ?? candidate.availableQty);
      if (supplierLeft <= 0) continue;

      const compatibleQty = convertToBaseUnit(supplierLeft, candidate.unit, pool.lineItem.unit);
      const allocateQty = Math.min(remaining, compatibleQty);
      if (allocateQty <= 0) continue;

      const subtotal = allocateQty * candidate.pricePerUnit;
      if (pool.lineItem.maxPricePerUnit && candidate.pricePerUnit > pool.lineItem.maxPricePerUnit) continue;
      if (constraints?.maxTotalBudget && totalCost + subtotal > constraints.maxTotalBudget) {
        const affordableQty = Math.floor((constraints.maxTotalBudget - totalCost) / candidate.pricePerUnit);
        if (affordableQty <= 0) continue;
        const adjSubtotal = affordableQty * candidate.pricePerUnit;
        allocations.push({
          lineItemIndex: pool.lineItemIndex,
          lineItemName: pool.lineItem.item,
          supplier: {
            listingId: candidate.listingId,
            supplierId: candidate.supplierId,
            supplierName: candidate.supplierName,
            item: candidate.item,
            title: candidate.title,
            pricePerUnit: candidate.pricePerUnit,
            imageId: candidate.imageId,
          },
          allocatedQty: affordableQty,
          unit: pool.lineItem.unit,
          subtotal: adjSubtotal,
          matchType: candidate.matchType,
          matchScore: candidate.matchScore,
          deliveryWindow: candidate.deliveryWindow,
        });
        remaining -= affordableQty;
        totalCost += adjSubtotal;
        supplierRemaining.set(candidate.listingId, supplierLeft - convertToBaseUnit(affordableQty, pool.lineItem.unit, candidate.unit));
        continue;
      }

      allocations.push({
        lineItemIndex: pool.lineItemIndex,
        lineItemName: pool.lineItem.item,
        supplier: {
          listingId: candidate.listingId,
          supplierId: candidate.supplierId,
          supplierName: candidate.supplierName,
          item: candidate.item,
          title: candidate.title,
          pricePerUnit: candidate.pricePerUnit,
          imageId: candidate.imageId,
        },
        allocatedQty: allocateQty,
        unit: pool.lineItem.unit,
        subtotal,
        matchType: candidate.matchType,
        matchScore: candidate.matchScore,
        deliveryWindow: candidate.deliveryWindow,
      });

      remaining -= allocateQty;
      totalCost += subtotal;
      supplierRemaining.set(candidate.listingId, supplierLeft - convertToBaseUnit(allocateQty, pool.lineItem.unit, candidate.unit));
      totalAvailable += allocateQty;
    }

    if (remaining > 0) {
      totalAvailable = pool.candidates.reduce((sum, c) => sum + convertToBaseUnit(c.availableQty, c.unit, pool.lineItem.unit), 0);
      unfulfillable.push({
        lineItemIndex: pool.lineItemIndex,
        lineItemName: pool.lineItem.item,
        qtyNeeded: pool.lineItem.qtyNeeded,
        qtyAvailable: Math.min(totalAvailable, pool.lineItem.qtyNeeded - remaining + totalAvailable),
        reason: totalAvailable === 0
          ? `No suppliers found for "${pool.lineItem.item}"`
          : `Only ${(pool.lineItem.qtyNeeded - remaining).toFixed(1)} ${pool.lineItem.unit} of ${pool.lineItem.qtyNeeded} ${pool.lineItem.unit} could be sourced`,
      });
    }
  }

  return { allocations, unfulfillable };
}

function computeMetrics(allocations: FulfillmentAllocation[], lineItems: OrderLineItem[]): StrategyMetrics {
  const totalCost = allocations.reduce((s, a) => s + a.subtotal, 0);
  const suppliers = new Set(allocations.map((a) => a.supplier.supplierId));
  const totalNeeded = lineItems.reduce((s, li) => s + li.qtyNeeded, 0);
  const totalAllocated = allocations.reduce((s, a) => s + a.allocatedQty, 0);
  const avgMatchScore = allocations.length > 0
    ? allocations.reduce((s, a) => s + a.matchScore * a.allocatedQty, 0) / Math.max(totalAllocated, 1)
    : 0;

  const deliveries = allocations.filter((a) => a.deliveryWindow?.startAt).map((a) => a.deliveryWindow!.startAt);
  const earliest = deliveries.length > 0 ? deliveries.sort()[0] : undefined;

  return {
    totalCost: Math.round(totalCost * 100) / 100,
    supplierCount: suppliers.size,
    coveragePercent: totalNeeded > 0 ? Math.round((totalAllocated / totalNeeded) * 100) : 0,
    avgMatchScore: Math.round(avgMatchScore * 100) / 100,
    estimatedDelivery: earliest,
  };
}

function generateStrategies(
  pools: CandidatePool[],
  lineItems: OrderLineItem[],
  constraints?: OptimizationConstraints
): { strategies: FulfillmentStrategy[]; allUnfulfillable: UnfulfillableItem[] } {
  const strategies: FulfillmentStrategy[] = [];
  let allUnfulfillable: UnfulfillableItem[] = [];

  // Strategy 1: Optimize for cost (cheapest first, weighted by match quality)
  const costResult = allocateGreedy(
    pools,
    (c) => c.matchScore * 0.3 + (1 / Math.max(c.pricePerUnit, 0.01)) * 0.7,
    constraints
  );
  if (costResult.allocations.length > 0) {
    strategies.push({
      id: generateStrategyId(),
      name: "Lowest Cost",
      description: "Prioritizes the most affordable suppliers while maintaining acceptable product match quality.",
      allocations: costResult.allocations,
      metrics: computeMetrics(costResult.allocations, lineItems),
      tradeoffs: buildTradeoffs(costResult, "cost"),
      rank: 0,
    });
    allUnfulfillable = costResult.unfulfillable;
  }

  // Strategy 2: Optimize for product quality (best match first)
  const qualityResult = allocateGreedy(
    pools,
    (c) => c.matchScore * 0.8 + (1 / Math.max(c.pricePerUnit, 0.01)) * 0.2,
    constraints
  );
  if (qualityResult.allocations.length > 0) {
    strategies.push({
      id: generateStrategyId(),
      name: "Best Match",
      description: "Prioritizes the closest product matches and highest-quality substitutions.",
      allocations: qualityResult.allocations,
      metrics: computeMetrics(qualityResult.allocations, lineItems),
      tradeoffs: buildTradeoffs(qualityResult, "quality"),
      rank: 0,
    });
    if (allUnfulfillable.length === 0) allUnfulfillable = qualityResult.unfulfillable;
  }

  // Strategy 3: Optimize for delivery speed
  const speedResult = allocateGreedy(
    pools,
    (c) => {
      const timeScore = c.deliveryWindow
        ? deliveryOverlap(constraints?.preferredDeliveryWindow, c.deliveryWindow)
        : 0.3;
      return timeScore * 0.5 + c.matchScore * 0.3 + (1 / Math.max(c.pricePerUnit, 0.01)) * 0.2;
    },
    constraints
  );
  if (speedResult.allocations.length > 0) {
    strategies.push({
      id: generateStrategyId(),
      name: "Fastest Delivery",
      description: "Prioritizes suppliers with the best delivery window alignment.",
      allocations: speedResult.allocations,
      metrics: computeMetrics(speedResult.allocations, lineItems),
      tradeoffs: buildTradeoffs(speedResult, "speed"),
      rank: 0,
    });
  }

  // Strategy 4: Minimize supplier count (consolidate)
  const supplierGroups = new Map<string, { total: number; candidates: SupplierCandidate[] }>();
  for (const pool of pools) {
    for (const c of pool.candidates) {
      const existing = supplierGroups.get(c.supplierId) ?? { total: 0, candidates: [] };
      existing.total += c.availableQty;
      existing.candidates.push(c);
      supplierGroups.set(c.supplierId, existing);
    }
  }

  const consolidatedResult = allocateGreedy(
    pools,
    (c) => {
      const group = supplierGroups.get(c.supplierId);
      const breadth = group ? Math.min(group.candidates.length / pools.length, 1) : 0;
      return breadth * 0.5 + c.matchScore * 0.3 + (1 / Math.max(c.pricePerUnit, 0.01)) * 0.2;
    },
    constraints
  );
  if (consolidatedResult.allocations.length > 0 && computeMetrics(consolidatedResult.allocations, lineItems).supplierCount < (strategies[0]?.metrics.supplierCount ?? Infinity)) {
    strategies.push({
      id: generateStrategyId(),
      name: "Fewest Suppliers",
      description: "Consolidates the order across the fewest number of suppliers for simpler logistics.",
      allocations: consolidatedResult.allocations,
      metrics: computeMetrics(consolidatedResult.allocations, lineItems),
      tradeoffs: buildTradeoffs(consolidatedResult, "consolidation"),
      rank: 0,
    });
  }

  // Rank strategies based on the requested priority
  const priority = constraints?.prioritize ?? "coverage";
  strategies.sort((a, b) => {
    switch (priority) {
      case "cost": return a.metrics.totalCost - b.metrics.totalCost;
      case "speed": return (b.metrics.estimatedDelivery ? 1 : 0) - (a.metrics.estimatedDelivery ? 1 : 0);
      case "quality": return b.metrics.avgMatchScore - a.metrics.avgMatchScore;
      case "coverage":
      default: return b.metrics.coveragePercent - a.metrics.coveragePercent || a.metrics.totalCost - b.metrics.totalCost;
    }
  });
  strategies.forEach((s, i) => { s.rank = i + 1; });

  return { strategies, allUnfulfillable };
}

function buildTradeoffs(
  result: { allocations: FulfillmentAllocation[]; unfulfillable: UnfulfillableItem[] },
  focus: string
): string[] {
  const tradeoffs: string[] = [];
  const suppliers = new Set(result.allocations.map((a) => a.supplier.supplierId));
  const subs = result.allocations.filter((a) => a.matchType !== "exact");
  const total = result.allocations.reduce((s, a) => s + a.subtotal, 0);

  if (suppliers.size > 3) tradeoffs.push(`Requires coordination with ${suppliers.size} different suppliers`);
  if (subs.length > 0) tradeoffs.push(`${subs.length} allocation(s) use substitute products`);
  if (result.unfulfillable.length > 0) tradeoffs.push(`${result.unfulfillable.length} item(s) cannot be fully fulfilled`);
  if (focus === "cost" && subs.length > 0) tradeoffs.push("Lower cost may come with less precise product matches");
  if (focus === "quality") tradeoffs.push("Higher match quality may cost more than the cheapest option");
  if (focus === "speed") tradeoffs.push("Faster delivery may limit supplier options");
  if (focus === "consolidation") tradeoffs.push("Fewer suppliers may mean higher cost or lower match quality");
  if (total === 0) tradeoffs.push("No allocations could be made within the given constraints");
  return tradeoffs;
}

// ---------------------------------------------------------------------------
// Phase 5: LLM explanation
// ---------------------------------------------------------------------------

async function generateExplanation(
  client: LLMClient | null,
  plan: {
    orderId: string;
    lineItems: OrderLineItem[];
    candidates: SupplierCandidate[];
    strategies: FulfillmentStrategy[];
    unfulfillable: UnfulfillableItem[];
  }
): Promise<{ summary: string; reasoning: string }> {
  const fallback = buildFallbackExplanation(plan);
  if (!client) return fallback;

  try {
    const top = plan.strategies[0];
    const planSummary = {
      lineItems: plan.lineItems.map((li) => `${li.qtyNeeded} ${li.unit} of ${li.item}`),
      topStrategy: top
        ? {
            name: top.name,
            totalCost: top.metrics.totalCost,
            supplierCount: top.metrics.supplierCount,
            coverage: `${top.metrics.coveragePercent}%`,
            avgMatch: `${(top.metrics.avgMatchScore * 100).toFixed(0)}%`,
            allocations: top.allocations.map((a) => `${a.allocatedQty} ${a.unit} of ${a.lineItemName} from ${a.supplier.supplierName} (${a.matchType}, $${a.subtotal.toFixed(2)})`),
          }
        : null,
      alternativeCount: plan.strategies.length - 1,
      unfulfillable: plan.unfulfillable.map((u) => `${u.lineItemName}: ${u.reason}`),
    };

    const res = await client.chat.completions.create({
      model: getLLMModel(),
      messages: [
        { role: "system", content: EXPLAIN_PLAN_SYSTEM },
        { role: "user", content: JSON.stringify(planSummary) },
      ],
      response_format: { type: "json_object" },
      max_tokens: 400,
    });
    const raw = res.choices[0]?.message?.content;
    if (raw) {
      const parsed = JSON.parse(raw) as { summary?: string; reasoning?: string };
      if (parsed.summary && parsed.reasoning) {
        return { summary: parsed.summary, reasoning: parsed.reasoning };
      }
    }
  } catch (err) {
    console.error("[Optimizer] LLM explanation failed:", err instanceof Error ? err.message : err);
  }

  return fallback;
}

function buildFallbackExplanation(plan: {
  orderId: string;
  lineItems: OrderLineItem[];
  candidates: SupplierCandidate[];
  strategies: FulfillmentStrategy[];
  unfulfillable: UnfulfillableItem[];
}): { summary: string; reasoning: string } {
  const top = plan.strategies[0];
  if (!top) {
    return {
      summary: "No fulfillment strategies could be generated. There may not be enough supply listings to meet this order.",
      reasoning: "The optimizer searched available supply listings but could not find sufficient matches for the requested items.",
    };
  }

  const summary = `Recommended strategy: "${top.name}" — sources from ${top.metrics.supplierCount} supplier(s) at $${top.metrics.totalCost.toFixed(2)} total, covering ${top.metrics.coveragePercent}% of the order.${plan.strategies.length > 1 ? ` ${plan.strategies.length - 1} alternative strategies are also available.` : ""}`;

  const parts: string[] = [
    `The "${top.name}" strategy was selected as the top recommendation.`,
    `It fulfills ${top.metrics.coveragePercent}% of the order across ${top.metrics.supplierCount} supplier(s) with an average product match score of ${(top.metrics.avgMatchScore * 100).toFixed(0)}%.`,
  ];
  if (plan.unfulfillable.length > 0) {
    parts.push(`${plan.unfulfillable.length} item(s) could not be fully sourced: ${plan.unfulfillable.map((u) => u.lineItemName).join(", ")}.`);
  }
  if (top.tradeoffs.length > 0) {
    parts.push(`Trade-offs: ${top.tradeoffs.join("; ")}.`);
  }

  return { summary, reasoning: parts.join(" ") };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runSourcingOptimizer(req: OptimizationRequest): Promise<SourcingPlan> {
  const client = getLLMClient();
  const orderId = `order-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Phase 1: Resolve line items
  let lineItems: OrderLineItem[] = [];
  if (req.lineItems && req.lineItems.length > 0) {
    lineItems = req.lineItems.map((li) => ({
      ...li,
      unit: normalizeUnit(li.unit),
      acceptSubstitutes: li.acceptSubstitutes !== false,
    }));
  } else if (req.orderDescription) {
    lineItems = client
      ? await parseOrderWithLLM(client, req.orderDescription)
      : [];
    if (lineItems.length === 0) {
      lineItems = parseOrderFallback(req.orderDescription);
    }
  }

  if (lineItems.length === 0) {
    return {
      orderId,
      lineItems: [],
      candidates: [],
      strategies: [],
      strategyOptions: [],
      recommendedStrategyId: null,
      unfulfillable: [],
      summary: "No order items could be identified. Please provide specific items and quantities.",
      reasoning: "The optimizer requires at least one line item (produce name + quantity) to generate a sourcing plan.",
    };
  }

  // Phase 2: Discover candidates
  const listingsByItem = await discoverCandidates(lineItems);

  // Phase 3: Score candidates
  const allCandidates: SupplierCandidate[] = [];
  const pools: CandidatePool[] = [];

  for (let i = 0; i < lineItems.length; i++) {
    const listings = listingsByItem.get(i) ?? [];
    const llmScores = client && listings.length > 0
      ? await scoreCandidatesWithLLM(client, lineItems[i], listings)
      : new Map();
    const candidates = buildCandidates(i, lineItems[i], listings, llmScores);
    allCandidates.push(...candidates);
    pools.push({ lineItemIndex: i, lineItem: lineItems[i], candidates });
  }

  // Phase 4: Generate strategies
  const { strategies, allUnfulfillable } = generateStrategies(pools, lineItems, req.constraints);

  // Phase 5: Generate explanation
  const planDraft = { orderId, lineItems, candidates: allCandidates, strategies, unfulfillable: allUnfulfillable };
  const { summary, reasoning } = await generateExplanation(client, planDraft);
  const strategyOptions = strategies.map((s) => ({
    strategyId: s.id,
    name: s.name,
    description: s.description,
    rank: s.rank,
    metrics: s.metrics,
    tradeoffs: s.tradeoffs,
  }));
  const recommendedStrategyId = strategies[0]?.id ?? null;

  return { ...planDraft, strategyOptions, recommendedStrategyId, summary, reasoning };
}
