import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { runQualityGate } from "../agents/qualityGate/graph.js";
import ReceivingBrief from "../models/ReceivingBrief.js";
import ReceivingBriefModel from "../models/ReceivingBrief.js";
import type { IReceivingBriefSupplierSection } from "../models/ReceivingBrief.js";
import DeviationFlag from "../models/DeviationFlag.js";
import { record_supplier_confirmation } from "../mcp/tools.js";
import { create_audit_log } from "../mcp/tools.js";
import SupplierConfirmationRequest from "../models/SupplierConfirmationRequest.js";
import { detectDeviations } from "../agents/qualityGate/deviation.js";

const querySchema = z.object({
  restaurantId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

const supplierConfirmBodySchema = z.object({
  orderId: z.string().min(1),
  supplierId: z.string().min(1),
  confirmQty: z.string().optional(),
  packSize: z.string().optional(),
  harvestDate: z.string().optional(),
  deliveryWindow: z.string().optional(),
  photoUrl: z.string().url().optional().or(z.literal("")),
});

type SupplierConfirmBody = z.infer<typeof supplierConfirmBodySchema>;

const qualityGateRoutes = new Hono();

// POST /agent/quality-gate/run?restaurantId=...&date=YYYY-MM-DD
qualityGateRoutes.post("/agent/quality-gate/run", async (c) => {
  const query = querySchema.safeParse({
    restaurantId: c.req.query("restaurantId"),
    date: c.req.query("date"),
  });
  if (!query.success) {
    return c.json(
      { error: "Invalid query", details: query.error.flatten() },
      400
    );
  }
  const { restaurantId, date } = query.data;
  try {
    const result = await runQualityGate(restaurantId, date);
    // Include any existing deviation flags for this brief
    let deviationFlags = result.deviationFlags;
    if (result.receivingBriefId) {
      const existing = await DeviationFlag.find({
        receivingBriefId: result.receivingBriefId,
      })
        .lean()
        .exec();
      deviationFlags = [
        ...result.deviationFlags,
        ...existing.map((f) => ({
          orderId: String(f.orderId),
          type: f.type,
          severity: f.severity,
          suggestedAction: f.suggestedAction,
        })),
      ];
    }
    return c.json({
      receivingBriefId: result.receivingBriefId,
      confirmationsRequested: result.confirmationsRequested,
      deviationFlags,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: message }, 500);
  }
});

// GET /receiving-brief?restaurantId=...&date=...
qualityGateRoutes.get("/receiving-brief", async (c) => {
  const query = querySchema.safeParse({
    restaurantId: c.req.query("restaurantId"),
    date: c.req.query("date"),
  });
  if (!query.success) {
    return c.json(
      { error: "Invalid query", details: query.error.flatten() },
      400
    );
  }
  const { restaurantId, date } = query.data;
  const start = new Date(date + "T00:00:00.000Z");
  const end = new Date(date + "T23:59:59.999Z");
  const brief = await ReceivingBrief.findOne({
    restaurantId,
    briefDate: { $gte: start, $lte: end },
  })
    .lean()
    .exec();
  if (!brief) {
    return c.json({ error: "Receiving brief not found for this date" }, 404);
  }
  return c.json({
    _id: String(brief._id),
    restaurantId: String(brief.restaurantId),
    briefDate: brief.briefDate.toISOString().slice(0, 10),
    sections: brief.sections.map((s: IReceivingBriefSupplierSection) => ({
      supplierId: String(s.supplierId),
      supplierName: s.supplierName,
      orderId: String(s.orderId),
      riskTier: s.riskTier,
      riskScore: s.riskScore,
      confirmationStatus: s.confirmationStatus,
      trackingStatus: s.trackingStatus ?? "",
      lineItems: s.lineItems,
    })),
    kitchenUiJson: brief.kitchenUiJson,
    createdAt: brief.createdAt.toISOString(),
  });
});

const updateTrackingBodySchema = z.object({
  restaurantId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  orderId: z.string().min(1),
  trackingStatus: z.string().max(500).optional(),
});

// PATCH /receiving-brief/tracking — update one section's tracking (midday check-in)
qualityGateRoutes.patch("/receiving-brief/tracking", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateTrackingBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      400
    );
  }
  const { restaurantId, date, orderId, trackingStatus } = parsed.data;
  const start = new Date(date + "T00:00:00.000Z");
  const end = new Date(date + "T23:59:59.999Z");
  const brief = await ReceivingBriefModel.findOne({
    restaurantId,
    briefDate: { $gte: start, $lte: end },
  }).exec();
  if (!brief) {
    return c.json({ error: "Receiving brief not found for this date" }, 404);
  }
  const sectionIndex = brief.sections.findIndex(
    (s: IReceivingBriefSupplierSection) => String(s.orderId) === orderId
  );
  if (sectionIndex === -1) {
    return c.json({ error: "Order not found in this brief" }, 404);
  }
  brief.sections[sectionIndex].trackingStatus = trackingStatus ?? "";
  if (brief.kitchenUiJson?.sections?.[sectionIndex]) {
    (brief.kitchenUiJson.sections[sectionIndex] as { trackingStatus?: string }).trackingStatus = trackingStatus ?? "";
  }
  await brief.save();
  return c.json({ ok: true, trackingStatus: brief.sections[sectionIndex].trackingStatus });
});

// POST /supplier/confirm — supplier submits confirmation
qualityGateRoutes.post(
  "/supplier/confirm",
  zValidator("json", supplierConfirmBodySchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: "Invalid body", details: result.error.flatten() }, 400);
    }
  }),
  async (c) => {
    const body = c.req.valid("json") as SupplierConfirmBody;
    const orderId = body.orderId;
    const supplierId = body.supplierId;

    const request = await SupplierConfirmationRequest.findOne({
      orderId,
      supplierId,
      status: "pending",
    }).exec();
    if (!request) {
      return c.json(
        { error: "No pending confirmation request for this order/supplier" },
        404
      );
    }

    const riskTier = request.riskTier;
    const requiredFields = request.requiredFields;
    if (riskTier === "HIGH" && requiredFields.includes("photoUrl")) {
      const hasPhoto = body.photoUrl && body.photoUrl.trim() !== "";
      if (!hasPhoto) {
        return c.json(
          { error: "HIGH risk tier requires photoUrl" },
          400
        );
      }
    }

    const rawPayload = {
      confirmQty: body.confirmQty,
      packSize: body.packSize,
      harvestDate: body.harvestDate,
      deliveryWindow: body.deliveryWindow,
      photoUrl: body.photoUrl,
    };

    await record_supplier_confirmation({
      orderId,
      supplierId,
      snapshot: {
        orderId,
        supplierId,
        riskTier,
        confirmedQty: body.confirmQty,
        confirmedPackSize: body.packSize,
        harvestDate: body.harvestDate,
        deliveryWindow: body.deliveryWindow,
        photoUrl: body.photoUrl ?? undefined,
        rawPayload,
      },
    });

    const brief = await ReceivingBriefModel.findOne({
      "sections.orderId": orderId,
    }).exec();
    if (brief) {
      const section = brief.sections.find(
        (s: IReceivingBriefSupplierSection) => String(s.orderId) === orderId
      );
      if (section) {
        await ReceivingBriefModel.updateOne(
          { _id: brief._id, "sections.orderId": orderId },
          { $set: { "sections.$.confirmationStatus": "confirmed" } }
        ).exec();

        const deviations = detectDeviations(section, {
          confirmedQty: body.confirmQty,
          confirmedPackSize: body.packSize,
          deliveryWindow: body.deliveryWindow,
        });
        for (const d of deviations) {
          await DeviationFlag.create({
            orderId,
            receivingBriefId: brief._id,
            type: d.type,
            severity: d.severity,
            description: d.description,
            suggestedAction: d.suggestedAction,
          });
        }
        await create_audit_log({
          eventType: "quality_gate.supplier_confirmed",
          entityId: orderId,
          entityType: "Order",
          payload: {
            orderId,
            supplierId,
            deviationCount: deviations.length,
          },
        });
      }
    }

    return c.json({
      ok: true,
      message: "Confirmation recorded",
    });
  }
);

export default qualityGateRoutes;
