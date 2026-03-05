/**
 * Demo seed for Pre-Arrival Quality Gate:
 * - 2 suppliers (1 with trust history, 1 new with no history)
 * - 3 orders (1 with high-risk perishable item, 1 from new supplier)
 * Run: npm run -w server seed:quality-gate
 */

import { connectDB } from "../src/db.js";
import mongoose from "mongoose";
import Order from "../src/models/Order.js";
import Supplier from "../src/models/Supplier.js";
import SupplierTrust from "../src/models/SupplierTrust.js";
import QualityTemplate from "../src/models/QualityTemplate.js";

const RESTAURANT_ID = new mongoose.Types.ObjectId();
const DATE = new Date();
const DATE_STR = DATE.toISOString().slice(0, 10);

async function seed() {
  await connectDB();

  const [supplier1, supplier2] = await Promise.all([
    Supplier.create({
      name: "Valley Fresh Produce",
      typicalMaxOrderValue: 300,
    }),
    Supplier.create({
      name: "New Horizon Farms",
      typicalMaxOrderValue: 150,
    }),
  ]);

  await SupplierTrust.create({
    supplierId: supplier1._id,
    reliability: 0.88,
    issueCount: 1,
    lastUpdated: new Date(),
  });
  // supplier2 has NO trust record => newSupplier +2 in risk

  const qualityTemplates = [
    {
      key: "berries",
      keyType: "category" as const,
      quickQualityChecks: [
        "Check for mold or soft spots",
        "Verify count per clamshell",
        "Confirm cold chain",
        "No leaking or crushed units",
      ],
      defaultAcceptableVarianceQtyPercent: 5,
      defaultPackagingNote: "Clamshell or punnet; confirm case count",
    },
    {
      key: "herbs",
      keyType: "category" as const,
      quickQualityChecks: [
        "Check for wilt or yellowing",
        "Verify bunch count",
        "Confirm harvest date if labeled",
      ],
      defaultAcceptableVarianceQtyPercent: 10,
    },
    {
      key: "vegetables",
      keyType: "category" as const,
      quickQualityChecks: [
        "Check for damage or bruising",
        "Verify weight",
        "Confirm grade/size if specified",
      ],
      defaultAcceptableVarianceQtyPercent: 5,
    },
  ];
  for (const t of qualityTemplates) {
    await QualityTemplate.findOneAndUpdate(
      { key: t.key, keyType: t.keyType },
      { $set: t },
      { upsert: true }
    );
  }

  const orderDate = new Date(DATE_STR + "T12:00:00.000Z");
  const deliveryWideStart = new Date(DATE_STR + "T08:00:00.000Z");
  const deliveryWideEnd = new Date(DATE_STR + "T18:00:00.000Z");
  const deliveryTightStart = new Date(DATE_STR + "T14:00:00.000Z");
  const deliveryTightEnd = new Date(DATE_STR + "T16:00:00.000Z"); // 2h window => tightWindow +1

  await Order.insertMany([
    {
      restaurantId: RESTAURANT_ID,
      orderDate,
      supplierId: supplier1._id,
      lineItems: [
        {
          itemCanonical: "strawberries",
          itemDisplayName: "Strawberries",
          expectedQty: 20,
          unit: "kg",
          packSize: "12 x 1lb clamshell",
          category: "berries",
          substitutionRules: "No substitution",
        },
      ],
      deliveryWindowStart: deliveryTightStart,
      deliveryWindowEnd: deliveryTightEnd,
      status: "placed",
    },
    {
      restaurantId: RESTAURANT_ID,
      orderDate,
      supplierId: supplier1._id,
      lineItems: [
        {
          itemCanonical: "romaine",
          itemDisplayName: "Romaine lettuce",
          expectedQty: 10,
          unit: "count",
          category: "vegetables",
        },
      ],
      deliveryWindowStart: deliveryWideStart,
      deliveryWindowEnd: deliveryWideEnd,
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
      deliveryWindowStart: deliveryWideStart,
      deliveryWindowEnd: deliveryWideEnd,
      status: "placed",
    },
  ]);

  console.log("Quality Gate seed done.");
  console.log("  RestaurantId (for API):", String(RESTAURANT_ID));
  console.log("  Date:", DATE_STR);
  console.log("  Suppliers: Valley Fresh (with trust), New Horizon (new, no history)");
  console.log("  Orders: 3 (1 high-risk perishable + tight window, 1 veg, 1 from new supplier)");
  console.log("\nStart the server in another terminal, then run:");
  console.log("  npm run -w server dev");
  console.log("\nThen (with server running on port 3000):");
  console.log(
    `  curl -X POST "http://localhost:3000/agent/quality-gate/run?restaurantId=${RESTAURANT_ID}&date=${DATE_STR}"`
  );
  console.log(
    `  curl "http://localhost:3000/receiving-brief?restaurantId=${RESTAURANT_ID}&date=${DATE_STR}"`
  );
  await mongoose.disconnect();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
