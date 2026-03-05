/**
 * Detect deviations from supplier confirmation vs brief expectations.
 * Used when supplier submits POST /supplier/confirm.
 */

import type { IReceivingBrief } from "../../models/ReceivingBrief.js";

export type DeviationType =
  | "qty_variance"
  | "pack_size_mismatch"
  | "delivery_window_outside_range"
  | "other";

export type DeviationSeverity = "low" | "medium" | "high";

export interface DeviationCandidate {
  type: DeviationType;
  severity: DeviationSeverity;
  description: string;
  suggestedAction: string;
}

const DEFAULT_QTY_VARIANCE_PERCENT = 5;

/**
 * Parse acceptableVariance string for qty % (e.g. "Qty ±5%; ..." => 5).
 */
function parseVariancePercent(acceptableVariance: string): number {
  const match = acceptableVariance.match(/±\s*(\d+)\s*%/);
  return match ? Number(match[1]) : DEFAULT_QTY_VARIANCE_PERCENT;
}

/**
 * Compare confirmed values to brief section and produce deviation flags.
 */
export function detectDeviations(
  section: NonNullable<IReceivingBrief["sections"]>[number],
  confirmed: {
    confirmedQty?: string;
    confirmedPackSize?: string;
    deliveryWindow?: string;
  }
): DeviationCandidate[] {
  const out: DeviationCandidate[] = [];
  const orderId = section.orderId;

  // Qty variance: compare confirmed qty to expected (simple: parse first number from confirmedQty vs section lineItems total or per-item)
  if (confirmed.confirmedQty != null && confirmed.confirmedQty.trim() !== "") {
    const expectedTotal = section.lineItems.reduce(
      (s, li) => s + li.expectedQty,
      0
    );
    const confirmedNum = parseFloat(confirmed.confirmedQty.replace(/[^0-9.]/g, ""));
    if (!Number.isNaN(confirmedNum) && expectedTotal > 0) {
      const variancePct = section.lineItems[0]
        ? parseVariancePercent(section.lineItems[0].acceptableVariance)
        : DEFAULT_QTY_VARIANCE_PERCENT;
      const diffPct = Math.abs(confirmedNum - expectedTotal) / expectedTotal * 100;
      if (diffPct > variancePct) {
        out.push({
          type: "qty_variance",
          severity: diffPct > variancePct * 2 ? "high" : "medium",
          description: `Confirmed qty ${confirmedNum} differs from expected ${expectedTotal} by more than ±${variancePct}%.`,
          suggestedAction: "Verify with supplier; adjust receiving checklist or reject variance.",
        });
      }
    }
  }

  // Pack size: compare confirmedPackSize to packagingExpectation (string match / contains)
  if (
    confirmed.confirmedPackSize != null &&
    confirmed.confirmedPackSize.trim() !== ""
  ) {
    const expectations = section.lineItems.map(
      (li) => li.packagingExpectation.toLowerCase()
    );
    const confirmedLower = confirmed.confirmedPackSize.toLowerCase();
    const notSpecified = expectations.every(
      (e) => e.includes("not specified") || e.includes("confirm pack size")
    );
    if (!notSpecified) {
      const matches = expectations.some(
        (exp) =>
          exp.includes(confirmedLower) ||
          confirmedLower.includes(exp) ||
          exp === confirmedLower
      );
      if (!matches) {
        out.push({
          type: "pack_size_mismatch",
          severity: "medium",
          description: `Confirmed pack size "${confirmed.confirmedPackSize}" does not match expectation.`,
          suggestedAction: "Confirm pack size with supplier; update brief if acceptable.",
        });
      }
    }
  }

  // Delivery window: if brief has a delivery window we could compare; for now we don't store expected window in brief, so skip or use "other" if needed
  if (confirmed.deliveryWindow != null && confirmed.deliveryWindow.trim() !== "") {
    // Optional: parse and compare to order's deliveryWindowStart/End if we pass it in
    // For now we don't add delivery_window_outside_range unless we have expected range in context
  }

  return out;
}
