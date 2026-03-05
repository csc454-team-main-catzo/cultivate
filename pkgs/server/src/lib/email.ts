/**
 * Send receiving brief email via Resend.
 * Set RESEND_API_KEY and RESEND_FROM (e.g. "Cultivate <receiving@yourdomain.com>") in env.
 * If RESEND_API_KEY is unset, no email is sent and sendBriefEmail returns false.
 */

type BriefSection = {
  supplierName: string;
  orderId: string;
  riskTier: string;
  confirmationStatus: string;
  trackingStatus?: string;
  lineItems: Array<{
    itemDisplayName: string;
    expectedQty: number;
    unit: string;
    packagingExpectation?: string;
    quickQualityChecks?: string[];
  }>;
};

type BriefForEmail = {
  briefDate: string;
  sections: BriefSection[];
};

function buildBriefHtml(brief: BriefForEmail): string {
  const sectionsHtml = brief.sections
    .map(
      (s) => `
    <div style="margin:1em 0; padding:1em; border:1px solid #e5e7eb; border-radius:8px;">
      <p style="margin:0 0 0.5em 0;"><strong>Supplier:</strong> ${escapeHtml(s.supplierName)}</p>
      <p style="margin:0 0 0.5em 0;"><strong>Risk:</strong> ${escapeHtml(s.riskTier)} &nbsp; <strong>Status:</strong> ${escapeHtml(s.confirmationStatus)}</p>
      <p style="margin:0 0 0.5em 0;"><strong>Tracking:</strong> ${escapeHtml((s.trackingStatus || "").trim() || "—")}</p>
      <ul style="margin:0.5em 0 0 1em; padding:0;">
        ${(s.lineItems || [])
          .map(
            (li) =>
              `<li>${escapeHtml(li.itemDisplayName)} — ${li.expectedQty} ${escapeHtml(li.unit)}${li.packagingExpectation ? ` · ${escapeHtml(li.packagingExpectation)}` : ""}</li>`
          )
          .join("")}
      </ul>
    </div>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Receiving brief ${escapeHtml(brief.briefDate)}</title></head>
<body style="font-family:system-ui,sans-serif; line-height:1.5; color:#374151; max-width:600px; margin:0 auto; padding:1em;">
  <h1 style="font-size:1.25rem; color:#111827;">Your receiving brief — ${escapeHtml(brief.briefDate)}</h1>
  <p style="color:#6b7280;">Before delivery: add tracking in the app when your supplier sends it. End of day we compare expected vs received and flag any gaps.</p>
  ${sectionsHtml}
  <p style="margin-top:1.5em; font-size:0.875rem; color:#9ca3af;">Sent by Cultivate Receiving.</p>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type SendBriefEmailResult =
  | { sent: true }
  | { sent: false; reason: "no_recipient" | "no_api_key" | "resend_error" };

export async function sendBriefEmail(
  to: string,
  brief: BriefForEmail
): Promise<SendBriefEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "Cultivate <onboarding@resend.dev>";

  if (!to.trim()) return { sent: false, reason: "no_recipient" };
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set; skipping brief email.");
    return { sent: false, reason: "no_api_key" };
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: [to.trim()],
      subject: `Receiving brief — ${brief.briefDate}`,
      html: buildBriefHtml(brief),
    });
    if (error) {
      console.error("[email] Resend error:", error);
      return { sent: false, reason: "resend_error" };
    }
    return { sent: true };
  } catch (e) {
    console.error("[email] send failed:", e);
    return { sent: false, reason: "resend_error" };
  }
}
