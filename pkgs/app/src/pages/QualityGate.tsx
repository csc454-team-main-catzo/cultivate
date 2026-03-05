import { useState, useEffect } from "react";
import {
  runQualityGate,
  getReceivingBrief,
  createDailyOrder,
  type RunQualityGateResult,
  type ReceivingBrief,
  type DailyOrderLineItem,
} from "../api/qualityGate.js";
import { suggestDeliveryWindows } from "../api/integrations.js";
import { useAuth0 } from "@auth0/auth0-react";
import { useUser } from "../providers/userContext.js";

const TODAY = new Date().toISOString().slice(0, 10);
const DEMO_OVERRIDE_ID = import.meta.env.VITE_DEMO_RESTAURANT_ID ?? "";
const SHOW_DEMO_OPTIONS = import.meta.env.DEV || !!DEMO_OVERRIDE_ID;

function riskBadgeClass(tier: string) {
  switch (tier) {
    case "HIGH":
      return "bg-red-100 text-red-800 border-red-200";
    case "MEDIUM":
      return "bg-harvest-100 text-harvest-800 border-harvest-200";
    default:
      return "bg-earth-100 text-earth-700 border-earth-200";
  }
}

export default function QualityGate() {
  const { user: auth0User, getAccessTokenSilently } = useAuth0();
  const { user, isLoading: userLoading } = useUser();
  const recipientEmail =
    (user as { email?: string | null } | undefined)?.email?.trim() ||
    (typeof auth0User?.email === "string" ? auth0User.email.trim() : "") ||
    undefined;
  // Real UX: restaurant = logged-in user. Demo: optional override when SHOW_DEMO_OPTIONS.
  const [demoRestaurantId, setDemoRestaurantId] = useState(DEMO_OVERRIDE_ID);
  const effectiveRestaurantId = (SHOW_DEMO_OPTIONS && demoRestaurantId.trim())
    ? demoRestaurantId.trim()
    : (user?._id ?? "");
  const [date, setDate] = useState(TODAY);
  const [showDemoOptions, setShowDemoOptions] = useState(!!DEMO_OVERRIDE_ID);
  const [runResult, setRunResult] = useState<RunQualityGateResult | null>(null);
  const [brief, setBrief] = useState<ReceivingBrief | null>(null);
  const [loading, setLoading] = useState<"run" | "brief" | "order" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [orderDate, setOrderDate] = useState(TODAY);
  const [deliveryStart, setDeliveryStart] = useState("14:00");
  const [deliveryEnd, setDeliveryEnd] = useState("16:00");
  const [suggestedWindows, setSuggestedWindows] = useState<Array<{ start: string; end: string }> | null>(null);
  const [lineItems, setLineItems] = useState<Array<{ itemDisplayName: string; expectedQty: number; unit: DailyOrderLineItem["unit"] }>>([
    { itemDisplayName: "", expectedQty: 0, unit: "kg" },
  ]);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);

  // Pre-calculate delivery windows from the user's Google Calendar for the order date; pre-fill first window.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSuggestedWindows(null);
      try {
        const token = await getAccessTokenSilently();
        const data = await suggestDeliveryWindows(token, {
          date: orderDate,
          durationMinutes: 120,
        });
        if (!cancelled && data.suggestedWindows.length > 0) {
          setSuggestedWindows(data.suggestedWindows);
          const first = data.suggestedWindows[0];
          setDeliveryStart(first.start);
          setDeliveryEnd(first.end);
        }
      } catch {
        if (!cancelled) setSuggestedWindows(null);
      }
    })();
    return () => { cancelled = true; };
  }, [orderDate, getAccessTokenSilently]);

  /** Run quality gate then load the brief so one action shows the full result. */
  async function handleGetBrief() {
    setError(null);
    setLoading("run");
    setRunResult(null);
    setBrief(null);
    try {
      const result = await runQualityGate(effectiveRestaurantId, date);
      setRunResult(result);
      const data = await getReceivingBrief(effectiveRestaurantId, date);
      setBrief(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not get brief");
    } finally {
      setLoading(null);
    }
  }

  /** Load existing brief only (e.g. after navigating back). */
  async function handleLoadBrief() {
    setError(null);
    setLoading("brief");
    try {
      const data = await getReceivingBrief(effectiveRestaurantId, date);
      setBrief(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(null);
    }
  }

  function addLineItem() {
    setLineItems((prev) => [...prev, { itemDisplayName: "", expectedQty: 0, unit: "kg" }]);
  }
  function removeLineItem(i: number) {
    setLineItems((prev) => prev.filter((_, idx) => idx !== i));
  }
  function updateLineItem(
    i: number,
    field: "itemDisplayName" | "expectedQty" | "unit",
    value: string | number
  ) {
    setLineItems((prev) =>
      prev.map((row, idx) =>
        idx === i ? { ...row, [field]: value } : row
      )
    );
  }

  async function handleSubmitOrder() {
    setError(null);
    setOrderSuccess(null);
    const valid = lineItems.filter(
      (r) => r.itemDisplayName.trim() !== "" && r.expectedQty > 0
    );
    if (valid.length === 0) {
      setError("Add at least one item with a name and quantity.");
      return;
    }
    setLoading("order");
    try {
      const body = {
        restaurantId: effectiveRestaurantId,
        orderDate,
        deliveryWindowStart: deliveryStart,
        deliveryWindowEnd: deliveryEnd,
        lineItems: valid.map((r) => ({
          itemCanonical: r.itemDisplayName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "item",
          itemDisplayName: r.itemDisplayName.trim(),
          expectedQty: r.expectedQty,
          unit: r.unit,
        })),
        ...(recipientEmail && { recipientEmail }),
      };
      const token = await getAccessTokenSilently().catch(() => null);
      const result = await createDailyOrder(body, token ?? undefined);
      const reasonMsg =
        result.emailSkippedReason === "no_api_key"
          ? " Email not sent: RESEND_API_KEY is not set on the server."
          : result.emailSkippedReason === "no_recipient"
            ? " Email not sent: no email address available."
            : result.emailSkippedReason === "no_brief"
              ? " Email not sent: receiving brief not ready yet."
              : result.emailSkippedReason === "send_failed"
                ? " Email not sent: server could not send (check server logs)."
                : "";
      const calendarMsg =
        result.calendarEventCreated || result.calendarEventUpdated
          ? " A delivery event was added to your Google Calendar."
          : "";
      setOrderSuccess(
        result.emailSent
          ? `Order created. We've emailed your receiving brief to your account email.${calendarMsg}`
          : `Order created. The system assigned the best available supplier. Get your brief above.${calendarMsg}${reasonMsg}`
      );
      setDate(orderDate);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create order failed");
    } finally {
      setLoading(null);
    }
  }

  const sectionsToRender = brief?.kitchenUiJson?.sections ?? brief?.sections ?? [];
  const canRun = effectiveRestaurantId && date.trim();

  if (userLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-leaf-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-earth-500 text-sm font-medium">Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="card p-8 text-center">
          <h1 className="font-display text-xl text-earth-900 mb-2">Receiving</h1>
          <p className="text-earth-600">Sign in to view your receiving brief and run the quality gate.</p>
        </div>
      </div>
    );
  }

  const [showLegend, setShowLegend] = useState(false);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <h1 className="font-display text-2xl sm:text-3xl text-earth-900 mb-2">
        Receiving
      </h1>
      <p className="text-earth-600 text-sm mb-8">
        Your brief tells you what to expect at the door, who’s delivering it, and what to check. End of day we compare expected vs received and flag any gaps.
      </p>

      {/* Step 1: Get your brief — primary action */}
      <div className="card p-4 sm:p-6 mb-6">
        <h2 className="font-display text-lg text-earth-900 mb-1">1. Get your brief</h2>
        <p className="text-sm text-earth-600 mb-4">
          Pick a date and generate your receiving brief (supplier, items, quality checks).
        </p>
        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div className="sm:w-48">
            <label className="block text-sm font-medium text-earth-700 mb-1">For date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 focus:outline-none focus:ring-2 focus:ring-leaf-400"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleGetBrief}
              disabled={loading !== null || !canRun}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading === "run" ? "Loading…" : "Get brief"}
            </button>
            {brief && (
              <button
                type="button"
                onClick={handleLoadBrief}
                disabled={loading !== null || !canRun}
                className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading === "brief" ? "Loading…" : "Refresh brief"}
              </button>
            )}
          </div>
        </div>
        {SHOW_DEMO_OPTIONS && (
          <div className="mt-4 pt-4 border-t border-earth-200">
            <button
              type="button"
              onClick={() => setShowDemoOptions((v) => !v)}
              className="text-sm font-medium text-earth-600 hover:text-earth-800"
            >
              {showDemoOptions ? "Hide" : "Show"} developer options
            </button>
            {showDemoOptions && (
              <div className="mt-2">
                <label className="block text-xs font-medium text-earth-500 mb-1">Override restaurant ID (for seed/demo)</label>
                <input
                  type="text"
                  value={demoRestaurantId}
                  onChange={(e) => setDemoRestaurantId(e.target.value)}
                  placeholder="Paste ID from seed:quality-gate"
                  className="w-full max-w-md px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 text-sm font-mono placeholder-earth-400 focus:outline-none focus:ring-2 focus:ring-leaf-400"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      )}
      {runResult && runResult.confirmationsRequested.length === 0 && runResult.deviationFlags.length === 0 && !(brief && sectionsToRender.length > 0) && (
        <div className="card p-4 sm:p-6 mb-6 border-earth-200 bg-earth-50/50">
          <p className="font-medium text-earth-800">No orders for {date}</p>
          <p className="text-sm text-earth-600 mt-1">
            Add an order below for this date, then click <strong>Get brief</strong> again.
          </p>
          <p className="text-xs text-earth-500 mt-3">
            Demo: run <code className="px-1 py-0.5 bg-earth-200 rounded">npm run -w server seed:quality-gate</code>, then use Developer options above with the printed Restaurant ID and date.
          </p>
        </div>
      )}

      {runResult && runResult.deviationFlags.length > 0 && (
        <div className="card p-4 sm:p-6 mb-6">
          <h3 className="text-sm font-medium text-earth-800 mb-2">Heads up</h3>
          <ul className="space-y-2">
            {runResult.deviationFlags.map((f, i) => (
              <li key={i} className="p-3 rounded-lg bg-harvest-50 border border-harvest-200 text-sm">
                <span className="font-medium text-earth-800">{f.type}</span>
                <p className="text-earth-700 mt-1">{f.suggestedAction}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief && sectionsToRender.length > 0 && (
        <div className="mb-6">
          <h2 className="font-display text-lg text-earth-900 mb-2">2. Your brief for {brief.briefDate}</h2>
          <button
            type="button"
            onClick={() => setShowLegend((v) => !v)}
            className="text-xs font-medium text-earth-500 hover:text-earth-700 mb-3"
          >
            {showLegend ? "Hide" : "What do risk and status mean?"}
          </button>
          {showLegend && (
            <p className="text-xs text-earth-500 mb-3 p-3 rounded-lg bg-earth-50 border border-earth-200">
              <strong>Risk:</strong> LOW = routine; MEDIUM/HIGH = we verified this order.{" "}
              <strong>Status:</strong> “not required” = no extra check; “confirmed” = locked in for receiving.
            </p>
          )}
          <div className="space-y-4">
            {sectionsToRender.map((section, idx) => (
              <div key={idx} className="card p-4 sm:p-6">
                <div className="flex flex-wrap items-baseline gap-2 mb-2">
                  <span className="text-xs font-medium text-earth-500 uppercase tracking-wide">Supplier</span>
                  <span className="font-medium text-earth-900">
                    {(section as { supplierName?: string }).supplierName ?? ""}
                  </span>
                  <span
                    className={`ml-auto px-2 py-0.5 rounded text-xs font-medium border ${riskBadgeClass(
                      section.riskTier
                    )}`}
                  >
                    {section.riskTier}
                  </span>
                  <span className="text-earth-500 text-xs">
                    {(section as { confirmationStatus?: string }).confirmationStatus ?? ""}
                  </span>
                </div>
                <div className="text-sm text-earth-600 mb-3">
                  <strong>Tracking:</strong>{" "}
                  {(section as { trackingStatus?: string }).trackingStatus?.trim()
                    ? (section as { trackingStatus: string }).trackingStatus
                    : "— Add at check-in"}
                </div>
                <ul className="space-y-3">
                  {section.lineItems.map((item, i) => (
                    <li key={i} className="pl-3 border-l-2 border-leaf-200">
                      <div className="font-medium text-earth-800">{item.itemDisplayName}</div>
                      <div className="text-sm text-earth-600">
                        {item.expectedQty} {item.unit}
                        {(item as { packagingExpectation?: string }).packagingExpectation && (
                          <> · {(item as { packagingExpectation?: string }).packagingExpectation}</>
                        )}
                      </div>
                      {(item as { quickQualityChecks?: string[] }).quickQualityChecks?.length ? (
                        <ul className="mt-1 text-xs text-earth-600 list-disc list-inside">
                          {(item as { quickQualityChecks: string[] }).quickQualityChecks.map((q, j) => (
                            <li key={j}>{q}</li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-6 p-4 rounded-lg bg-sage-50 border border-sage-200 text-sm text-earth-700">
            <strong className="text-earth-800">End of day</strong>
            <p className="mt-1">We compare expected vs received and flag any gaps.</p>
          </div>
        </div>
      )}

      {/* 3. Add an order */}
      <div className="card p-4 sm:p-6">
        <h2 className="font-display text-lg text-earth-900 mb-1">3. Add an order</h2>
        <p className="text-sm text-earth-600 mb-4">
          Need to place a new order? Add items and we’ll assign the best supplier. We'll email the receiving brief to your account email.
        </p>
        <div className="grid gap-3 sm:grid-cols-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-earth-700 mb-1">Order date</label>
            <input
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 focus:outline-none focus:ring-2 focus:ring-leaf-400"
            />
          </div>
          {suggestedWindows && suggestedWindows.length > 0 ? (
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-earth-700 mb-1">Delivery window (from your calendar)</label>
              <select
                value={Math.max(
                  0,
                  suggestedWindows.findIndex((w) => w.start === deliveryStart && w.end === deliveryEnd)
                )}
                onChange={(e) => {
                  const i = Number(e.target.value);
                  const w = suggestedWindows[i];
                  if (w) {
                    setDeliveryStart(w.start);
                    setDeliveryEnd(w.end);
                  }
                }}
                className="w-full px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 focus:outline-none focus:ring-2 focus:ring-leaf-400"
              >
                {suggestedWindows.map((w, i) => (
                  <option key={i} value={i}>
                    {w.start} – {w.end}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-earth-700 mb-1">Delivery window start</label>
                <input
                  type="time"
                  value={deliveryStart}
                  onChange={(e) => setDeliveryStart(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 focus:outline-none focus:ring-2 focus:ring-leaf-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-earth-700 mb-1">Delivery window end</label>
                <input
                  type="time"
                  value={deliveryEnd}
                  onChange={(e) => setDeliveryEnd(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 focus:outline-none focus:ring-2 focus:ring-leaf-400"
                />
              </div>
            </>
          )}
        </div>
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-earth-700">Items</span>
            <button type="button" onClick={addLineItem} className="text-sm font-medium text-leaf-600 hover:text-leaf-700">
              + Add item
            </button>
          </div>
          {lineItems.map((row, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={row.itemDisplayName}
                onChange={(e) => updateLineItem(i, "itemDisplayName", e.target.value)}
                placeholder="e.g. Romaine lettuce"
                className="flex-1 min-w-[120px] px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 placeholder-earth-400 focus:outline-none focus:ring-2 focus:ring-leaf-400 text-sm"
              />
              <input
                type="number"
                min={0}
                value={row.expectedQty || ""}
                onChange={(e) => updateLineItem(i, "expectedQty", Number(e.target.value) || 0)}
                placeholder="Qty"
                className="w-20 px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 focus:outline-none focus:ring-2 focus:ring-leaf-400 text-sm"
              />
              <select
                value={row.unit}
                onChange={(e) => updateLineItem(i, "unit", e.target.value as DailyOrderLineItem["unit"])}
                className="px-3 py-2 rounded-lg border border-earth-300 bg-earth-50 text-earth-900 focus:outline-none focus:ring-2 focus:ring-leaf-400 text-sm"
              >
                <option value="kg">kg</option>
                <option value="lb">lb</option>
                <option value="count">count</option>
                <option value="bunch">bunch</option>
                <option value="case">case</option>
              </select>
              {lineItems.length > 1 && (
                <button type="button" onClick={() => removeLineItem(i)} className="text-earth-500 hover:text-red-600 text-sm">
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={handleSubmitOrder}
          disabled={loading !== null || !effectiveRestaurantId}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === "order" ? "Creating…" : "Create order"}
        </button>
        {orderSuccess && (
          <p className="mt-3 text-sm text-leaf-700">{orderSuccess}</p>
        )}
      </div>

    </div>
  );
}
