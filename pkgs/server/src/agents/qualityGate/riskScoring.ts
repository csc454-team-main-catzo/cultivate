/**
 * Deterministic risk scoring for orders. Used by the Quality Gate graph.
 * No LLM; pure logic for auditability.
 */

export type RiskTier = "LOW" | "MEDIUM" | "HIGH";

const RELIABILITY_THRESHOLD = 0.7; // below => priorIssues
const TIGHT_WINDOW_HOURS = 6;
const PERISHABLE_CATEGORIES = new Set(["berries", "herbs", "seafood"]);

export interface RiskSignals {
  newSupplier: boolean;
  priorIssues: boolean;
  perishableHighValue: boolean;
  tightWindow: boolean;
  bigOrder: boolean;
}

export interface RiskScoreResult {
  score: number;
  tier: RiskTier;
  signals: RiskSignals;
  breakdown: string[];
}

export interface OrderRiskInput {
  hasTrustRecord: boolean;
  reliability?: number;
  categories: string[]; // from line items
  deliveryWindowHours: number;
  orderValueOrTotalQty?: number; // optional; compare to typicalMax
  supplierTypicalMax?: number;
}

/**
 * Compute risk score (0–5+) and tier for an order.
 */
export function computeOrderRisk(input: OrderRiskInput): RiskScoreResult {
  const breakdown: string[] = [];
  const signals: RiskSignals = {
    newSupplier: !input.hasTrustRecord,
    priorIssues: input.hasTrustRecord && (input.reliability ?? 1) < RELIABILITY_THRESHOLD,
    perishableHighValue: input.categories.some((c) =>
      PERISHABLE_CATEGORIES.has(c.toLowerCase())
    ),
    tightWindow: input.deliveryWindowHours < TIGHT_WINDOW_HOURS,
    bigOrder:
      input.supplierTypicalMax != null &&
      input.orderValueOrTotalQty != null &&
      input.orderValueOrTotalQty > input.supplierTypicalMax,
  };

  let score = 0;
  if (signals.newSupplier) {
    score += 2;
    breakdown.push("newSupplier: no trust history (+2)");
  }
  if (signals.priorIssues) {
    score += 2;
    breakdown.push("priorIssues: reliability below threshold (+2)");
  }
  if (signals.perishableHighValue) {
    score += 1;
    breakdown.push("perishableHighValue: category in berries/herbs/seafood (+1)");
  }
  if (signals.tightWindow) {
    score += 1;
    breakdown.push("tightWindow: delivery window < 6h (+1)");
  }
  if (signals.bigOrder) {
    score += 1;
    breakdown.push("bigOrder: above supplier typical max (+1)");
  }

  let tier: RiskTier;
  if (score <= 1) tier = "LOW";
  else if (score <= 3) tier = "MEDIUM";
  else tier = "HIGH";

  return { score, tier, signals, breakdown };
}

/**
 * Compute delivery window length in hours (from start to end).
 */
export function deliveryWindowHours(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return 0;
  return (end - start) / (1000 * 60 * 60);
}
