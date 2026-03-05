import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import Order from "../models/Order.js";
import ReceivingBrief from "../models/ReceivingBrief.js";
import { list_suppliers_with_trust } from "../mcp/tools.js";
import { runQualityGate } from "../agents/qualityGate/graph.js";
import { sendBriefEmail } from "../lib/email.js";

const orderLineItemSchema = z.object({
  itemCanonical: z.string().min(1).trim(),
  itemDisplayName: z.string().min(1).trim(),
  expectedQty: z.number().min(0),
  unit: z.enum(["kg", "lb", "count", "bunch", "case"]),
  packSize: z.string().trim().optional(),
  category: z.string().trim().optional(),
});

const createOrderBodySchema = z.object({
  restaurantId: z.string().min(1),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deliveryWindowStart: z.string(), // ISO date-time or "HH:mm" (use with orderDate for date)
  deliveryWindowEnd: z.string(),
  lineItems: z.array(orderLineItemSchema).min(1),
  supplierId: z.string().optional(),
  /** If set, run quality gate and email this address the receiving brief (with tracking when added at midday check-in). */
  recipientEmail: z.union([z.string().email(), z.literal("")]).optional(),
});

function toISOTime(datePart: string, timeStr: string): string {
  const [h, m] = timeStr.trim().split(":");
  const hour = (h ?? "0").padStart(2, "0");
  const min = (m ?? "0").padStart(2, "0");
  return `${datePart}T${hour}:${min}:00.000Z`;
}

function parseWindow(
  orderDate: string,
  start: string,
  end: string
): { deliveryWindowStart: Date; deliveryWindowEnd: Date } {
  const datePart = orderDate.slice(0, 10);
  const startStr = start.length <= 8 && start.includes(":") ? toISOTime(datePart, start) : start;
  const endStr = end.length <= 8 && end.includes(":") ? toISOTime(datePart, end) : end;
  const deliveryWindowStart = new Date(startStr);
  const deliveryWindowEnd = new Date(endStr);
  if (isNaN(deliveryWindowStart.getTime()) || isNaN(deliveryWindowEnd.getTime())) {
    throw new Error("Invalid delivery window");
  }
  return { deliveryWindowStart, deliveryWindowEnd };
}

const ordersRoutes = new Hono();

ordersRoutes.post(
  "/orders",
  zValidator("json", createOrderBodySchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "Invalid body", details: result.error.flatten() }, 400);
    }
  }),
  async (c) => {
    const body = c.req.valid("json");
    let supplierId = body.supplierId;
    if (!supplierId) {
      const suppliers = await list_suppliers_with_trust();
      if (suppliers.length === 0) {
        return c.json(
          { error: "No suppliers in the system. Add suppliers or provide supplierId." },
          400
        );
      }
      const best = suppliers.reduce((a, b) =>
        a.reliability >= b.reliability ? a : b
      );
      supplierId = best._id;
    }
    const { deliveryWindowStart, deliveryWindowEnd } = parseWindow(
      body.orderDate,
      body.deliveryWindowStart,
      body.deliveryWindowEnd
    );
    const orderDate = new Date(body.orderDate + "T12:00:00.000Z");
    const doc = await Order.create({
      restaurantId: body.restaurantId,
      orderDate,
      supplierId,
      lineItems: body.lineItems,
      deliveryWindowStart,
      deliveryWindowEnd,
      status: "placed",
    });

    let emailSent = false;
    type EmailSkippedReason = "no_recipient" | "no_brief" | "no_api_key" | "send_failed";
    let emailSkippedReason: EmailSkippedReason | undefined;
    const recipientEmail = body.recipientEmail?.trim();
    if (!recipientEmail) {
      console.info("[orders] No recipientEmail in request; brief email skipped.");
      emailSkippedReason = "no_recipient";
    }
    if (recipientEmail) {
      try {
        const dateStr = body.orderDate.slice(0, 10);
        await runQualityGate(body.restaurantId, dateStr);
        const start = new Date(dateStr + "T00:00:00.000Z");
        const end = new Date(dateStr + "T23:59:59.999Z");
        const brief = await ReceivingBrief.findOne({
          restaurantId: body.restaurantId,
          briefDate: { $gte: start, $lte: end },
        })
          .lean()
          .exec();
        if (!brief) {
          console.warn("[orders] No receiving brief found after quality gate; brief email skipped.", {
            restaurantId: body.restaurantId,
            dateStr,
          });
          emailSkippedReason = "no_brief";
        }
        if (brief) {
          const briefForEmail = {
            briefDate: brief.briefDate.toISOString().slice(0, 10),
            sections: brief.sections.map((s) => ({
              supplierName: s.supplierName,
              orderId: String(s.orderId),
              riskTier: s.riskTier,
              confirmationStatus: s.confirmationStatus,
              trackingStatus: s.trackingStatus ?? "",
              lineItems: s.lineItems.map((li) => ({
                itemDisplayName: li.itemDisplayName,
                expectedQty: li.expectedQty,
                unit: li.unit,
                packagingExpectation: li.packagingExpectation,
                quickQualityChecks: li.quickQualityChecks,
              })),
            })),
          };
          const emailResult = await sendBriefEmail(recipientEmail, briefForEmail);
          emailSent = emailResult.sent;
          if (!emailResult.sent && emailResult.reason) {
            emailSkippedReason = emailResult.reason === "no_api_key" ? "no_api_key" : "send_failed";
          }
        }
      } catch (e) {
        console.error("[orders] Brief email failed:", e);
        emailSkippedReason = "send_failed";
      }
    }

    return c.json(
      {
        _id: String(doc._id),
        restaurantId: String(doc.restaurantId),
        orderDate: doc.orderDate.toISOString(),
        supplierId: String(doc.supplierId),
        lineItems: doc.lineItems,
        deliveryWindowStart: doc.deliveryWindowStart.toISOString(),
        deliveryWindowEnd: doc.deliveryWindowEnd.toISOString(),
        status: doc.status,
        emailSent,
        ...(emailSkippedReason && { emailSkippedReason }),
      },
      201
    );
  }
);

export default ordersRoutes;
