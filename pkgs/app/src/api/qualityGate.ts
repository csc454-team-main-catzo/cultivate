import { API_URL } from "../config.js";

export interface RunQualityGateResult {
  receivingBriefId: string | null;
  confirmationsRequested: Array<{ orderId: string; supplierId: string; riskTier: string }>;
  deviationFlags: Array<{ orderId: string; type: string; severity: string; suggestedAction: string }>;
}

export interface BriefSection {
  supplierId: string;
  supplierName: string;
  orderId: string;
  riskTier: string;
  riskScore?: number;
  confirmationStatus: string;
  trackingStatus?: string;
  lineItems: Array<{
    itemCanonical?: string;
    itemDisplayName: string;
    expectedQty: number;
    unit: string;
    packagingExpectation?: string;
    acceptableVariance?: string;
    quickQualityChecks?: string[];
    substitutionRules?: string;
    mismatchProcedure?: string;
    confidence?: string;
    assumptions?: string;
  }>;
}

export interface ReceivingBrief {
  _id: string;
  restaurantId: string;
  briefDate: string;
  sections: BriefSection[];
  kitchenUiJson?: {
    date: string;
    sections: Array<{
      supplierName: string;
      orderId: string;
      riskTier: string;
      confirmationStatus: string;
      trackingStatus?: string;
      lineItems: Array<{
        itemDisplayName: string;
        expectedQty: number;
        unit: string;
        packagingExpectation: string;
        quickQualityChecks: string[];
      }>;
    }>;
  };
  createdAt?: string;
}

export async function runQualityGate(
  restaurantId: string,
  date: string
): Promise<RunQualityGateResult> {
  const url = `${API_URL}/agent/quality-gate/run?restaurantId=${encodeURIComponent(restaurantId)}&date=${encodeURIComponent(date)}`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Run failed");
  }
  return res.json() as Promise<RunQualityGateResult>;
}

export async function getReceivingBrief(
  restaurantId: string,
  date: string
): Promise<ReceivingBrief> {
  const url = `${API_URL}/receiving-brief?restaurantId=${encodeURIComponent(restaurantId)}&date=${encodeURIComponent(date)}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) throw new Error("Receiving brief not found for this date");
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Fetch failed");
  }
  return res.json() as Promise<ReceivingBrief>;
}

export async function updateSectionTracking(
  restaurantId: string,
  date: string,
  orderId: string,
  trackingStatus: string
): Promise<{ ok: boolean; trackingStatus: string }> {
  const res = await fetch(`${API_URL}/receiving-brief/tracking`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ restaurantId, date, orderId, trackingStatus }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; trackingStatus?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Update failed");
  return { ok: data.ok ?? true, trackingStatus: data.trackingStatus ?? trackingStatus };
}

export interface DailyOrderLineItem {
  itemCanonical: string;
  itemDisplayName: string;
  expectedQty: number;
  unit: "kg" | "lb" | "count" | "bunch" | "case";
  packSize?: string;
  category?: string;
}

export interface CreateDailyOrderBody {
  restaurantId: string;
  orderDate: string;
  deliveryWindowStart: string;
  deliveryWindowEnd: string;
  lineItems: DailyOrderLineItem[];
  supplierId?: string;
  /** If set, we'll email this address the receiving brief (and tracking once added at midday check-in). */
  recipientEmail?: string;
}

export type EmailSkippedReason = "no_recipient" | "no_brief" | "no_api_key" | "send_failed";

export async function createDailyOrder(body: CreateDailyOrderBody): Promise<{
  _id: string;
  status: string;
  emailSent?: boolean;
  emailSkippedReason?: EmailSkippedReason;
}> {
  const res = await fetch(`${API_URL}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    _id?: string;
    status?: string;
    error?: string;
    emailSent?: boolean;
    emailSkippedReason?: EmailSkippedReason;
  };
  if (!res.ok) throw new Error(data.error ?? "Create order failed");
  return {
    _id: data._id ?? "",
    status: data.status ?? "placed",
    emailSent: data.emailSent,
    emailSkippedReason: data.emailSkippedReason,
  };
}
