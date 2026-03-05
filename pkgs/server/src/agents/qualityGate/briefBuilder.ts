/**
 * Build receiving brief sections from orders using templates only (no LLM).
 */

import type { OrderForBrief } from "../../mcp/types.js";
import type { ReceivingBriefSectionInput } from "../../mcp/types.js";
import type { SupplierProfile } from "../../mcp/types.js";
import type { SupplierTrust } from "../../mcp/types.js";
import { get_quality_template } from "../../mcp/tools.js";
import { computeOrderRisk, deliveryWindowHours } from "./riskScoring.js";

const DEFAULT_ACCEPTABLE_VARIANCE = "Qty ±5%; size grade per spec.";
const DEFAULT_MISMATCH_PROCEDURE =
  "Take photo, select issue type, agent drafts message.";
const DEFAULT_ASSUMPTIONS = "Based on order and category policy.";
const DEFAULT_CONFIDENCE = "Template-based; confirm pack size if not specified.";

async function getQualityChecksAndVariance(
  itemCanonical: string,
  category?: string
): Promise<{ quickQualityChecks: string[]; acceptableVariance: string }> {
  const byItem = await get_quality_template({ itemCanonical });
  const byCategory =
    category != null ? await get_quality_template({ category }) : null;
  const t = byItem ?? byCategory ?? null;
  const quickQualityChecks =
    t?.quickQualityChecks ?? [
      "Check for damage or spoilage",
      "Verify count/weight matches label",
      "Confirm within use-by window",
    ];
  const acceptableVariance =
    t?.defaultAcceptableVarianceQtyPercent != null
      ? `Qty ±${t.defaultAcceptableVarianceQtyPercent}%; size grade per spec.`
      : DEFAULT_ACCEPTABLE_VARIANCE;
  return { quickQualityChecks, acceptableVariance };
}

export async function buildSectionForOrder(
  order: OrderForBrief,
  profile: SupplierProfile | null,
  trust: SupplierTrust | null
): Promise<ReceivingBriefSectionInput> {
  const categories = [
    ...new Set(
      order.lineItems.map((li) => li.category).filter((c): c is string => !!c)
    ),
  ];
  const windowHours = deliveryWindowHours(
    order.deliveryWindowStart,
    order.deliveryWindowEnd
  );
  const totalQty = order.lineItems.reduce((s, li) => s + li.expectedQty, 0);
  const riskResult = computeOrderRisk({
    hasTrustRecord: trust != null,
    reliability: trust?.reliability,
    categories,
    deliveryWindowHours: windowHours,
    orderValueOrTotalQty: totalQty,
    supplierTypicalMax: profile?.typicalMaxOrderValue,
  });

  const lineItems = await Promise.all(
    order.lineItems.map(async (li) => {
      const { quickQualityChecks, acceptableVariance } =
        await getQualityChecksAndVariance(li.itemCanonical, li.category);
      const packagingExpectation =
        li.packSize?.trim() || "Not specified; confirm pack size.";
      const substitutionRules = li.substitutionRules?.trim() || "Per order and default policy.";
      return {
        itemCanonical: li.itemCanonical,
        itemDisplayName: li.itemDisplayName,
        expectedQty: li.expectedQty,
        unit: li.unit,
        packagingExpectation,
        acceptableVariance,
        quickQualityChecks,
        substitutionRules,
        mismatchProcedure: DEFAULT_MISMATCH_PROCEDURE,
        confidence: DEFAULT_CONFIDENCE,
        assumptions: DEFAULT_ASSUMPTIONS,
      };
    })
  );

  return {
    supplierId: order.supplierId,
    supplierName: profile?.name ?? "Unknown Supplier",
    orderId: order._id,
    riskTier: riskResult.tier,
    riskScore: riskResult.score,
    confirmationStatus:
      riskResult.tier === "LOW" ? "not_required" : "pending",
    lineItems,
  };
}
