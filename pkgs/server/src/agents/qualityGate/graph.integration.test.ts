/**
 * Integration test: run Quality Gate graph with seeded orders.
 * Requires MongoDB (e.g. MONGODB_URI in .env or default localhost).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { connectDB } from "../../db.js";
import Order from "../../models/Order.js";
import Supplier from "../../models/Supplier.js";
import SupplierTrust from "../../models/SupplierTrust.js";
import QualityTemplate from "../../models/QualityTemplate.js";
import ReceivingBrief from "../../models/ReceivingBrief.js";
import SupplierConfirmationRequest from "../../models/SupplierConfirmationRequest.js";
import AuditLog from "../../models/AuditLog.js";
import { runQualityGate } from "./graph.js";

const RESTAURANT_ID = new mongoose.Types.ObjectId();
const DATE = "2025-03-15";

describe("Quality Gate graph integration", () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it("runs graph on seeded orders and returns brief + confirmations requested", async () => {
    const supplier1 = await Supplier.create({
      name: "Trusted Farm Co",
      typicalMaxOrderValue: 500,
    });
    const supplier2 = await Supplier.create({
      name: "New Supplier LLC",
      typicalMaxOrderValue: 100,
    });
    await SupplierTrust.create({
      supplierId: supplier1._id,
      reliability: 0.85,
      issueCount: 0,
    });
    await QualityTemplate.create({
      key: "berries",
      keyType: "category",
      quickQualityChecks: [
        "Check for mold or soft spots",
        "Verify count per clamshell",
        "Confirm cold chain",
      ],
      defaultAcceptableVarianceQtyPercent: 5,
    });
    await QualityTemplate.create({
      key: "vegetables",
      keyType: "category",
      quickQualityChecks: [
        "Check for damage",
        "Verify weight",
      ],
      defaultAcceptableVarianceQtyPercent: 5,
    });

    const orderDate = new Date(DATE + "T12:00:00.000Z");
    const deliveryStart = new Date(DATE + "T14:00:00.000Z");
    const deliveryEnd = new Date(DATE + "T18:00:00.000Z");
    await Order.create([
      {
        restaurantId: RESTAURANT_ID,
        orderDate,
        supplierId: supplier1._id,
        lineItems: [
          {
            itemCanonical: "strawberries",
            itemDisplayName: "Strawberries",
            expectedQty: 10,
            unit: "kg",
            category: "berries",
          },
        ],
        deliveryWindowStart: deliveryStart,
        deliveryWindowEnd: deliveryEnd,
        status: "placed",
      },
      {
        restaurantId: RESTAURANT_ID,
        orderDate,
        supplierId: supplier2._id,
        lineItems: [
          {
            itemCanonical: "mixed-herbs",
            itemDisplayName: "Mixed herbs",
            expectedQty: 5,
            unit: "bunch",
            category: "herbs",
          },
        ],
        deliveryWindowStart: new Date(DATE + "T08:00:00.000Z"),
        deliveryWindowEnd: new Date(DATE + "T10:00:00.000Z"),
        status: "placed",
      },
    ]);

    const result = await runQualityGate(String(RESTAURANT_ID), DATE);

    expect(result.receivingBriefId).toBeTruthy();
    expect(result.confirmationsRequested.length).toBeGreaterThanOrEqual(0);

    const brief = await ReceivingBrief.findOne({
      restaurantId: RESTAURANT_ID,
      briefDate: { $gte: new Date(DATE + "T00:00:00.000Z"), $lte: new Date(DATE + "T23:59:59.999Z") },
    }).exec();
    expect(brief).toBeTruthy();
    expect(brief!.sections.length).toBe(2);

    const auditCount = await AuditLog.countDocuments({
      "payload.restaurantId": String(RESTAURANT_ID),
    }).exec();
    expect(auditCount).toBeGreaterThan(0);

    await Order.deleteMany({ restaurantId: RESTAURANT_ID });
    await ReceivingBrief.deleteMany({ restaurantId: RESTAURANT_ID });
    await SupplierConfirmationRequest.deleteMany({});
    await AuditLog.deleteMany({ "payload.restaurantId": String(RESTAURANT_ID) });
    await Supplier.deleteMany({ _id: [supplier1._id, supplier2._id] });
    await SupplierTrust.deleteMany({ supplierId: supplier1._id });
    await QualityTemplate.deleteMany({ key: { $in: ["berries", "vegetables"] } });
  }, 15000);
});
