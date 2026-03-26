/**
 * Inserts sourcing-optimizer demo supply listings for two farmer accounts.
 *
 * Usage: `pnpm --filter server exec tsx --env-file=.env scripts/seed_demo_sourcing_listings.ts`
 *
 * Idempotent: removes prior rows with the same demo marker for these users, then re-inserts.
 */

import mongoose from "mongoose";
import Listing from "../src/models/Listing.js";
import { User } from "../src/models/User.js";

const DEMO_MARKER = "__demo_sourcing_fixture__";

const TORONTO_LATLNG: [number, number] = [43.6532, -79.3832];
const TORONTO_POSTAL = "M5H 2N2";

type Row = {
  title: string;
  item: string;
  description: string;
  price: number;
  qty: number;
  unit: "kg";
};

const FARM_A_EMAIL = "farm@gmail.com";
const FARM_B_EMAIL = "farmer1@gmail.com";

/** farm@gmail.com — tomato + spinach (Mid / Premium / Value each) */
const LISTINGS_FARM_A: Row[] = [
  {
    title: "Farm Mid — Tomatoes (standard)",
    item: "tomato",
    description: `${DEMO_MARKER} Standard field tomato, limited lot.`,
    price: 5.0,
    qty: 10,
    unit: "kg",
  },
  {
    title: "Farm Premium — Heirloom Tomatoes",
    item: "tomato",
    description: `${DEMO_MARKER} Premium bulk tomato, higher price.`,
    price: 12.0,
    qty: 50,
    unit: "kg",
  },
  {
    title: "Farm Value — Roma Tomatoes",
    item: "roma tomato",
    description: `${DEMO_MARKER} Value roma / paste type (substitute for tomato).`,
    price: 1.8,
    qty: 80,
    unit: "kg",
  },
  {
    title: "Farm Mid — Spinach",
    item: "spinach",
    description: `${DEMO_MARKER} Standard spinach, limited lot.`,
    price: 6.0,
    qty: 6,
    unit: "kg",
  },
  {
    title: "Farm Premium — Spinach (bulk)",
    item: "spinach",
    description: `${DEMO_MARKER} Premium spinach, large lot.`,
    price: 13.0,
    qty: 40,
    unit: "kg",
  },
  {
    title: "Farm Value — Baby Spinach",
    item: "baby spinach",
    description: `${DEMO_MARKER} Baby spinach (substitute overlap).`,
    price: 2.1,
    qty: 60,
    unit: "kg",
  },
];

/** farmer1@gmail.com — carrot + cucumber */
const LISTINGS_FARM_B: Row[] = [
  {
    title: "Farm Mid — Carrots",
    item: "carrot",
    description: `${DEMO_MARKER} Standard carrots, limited lot.`,
    price: 3.5,
    qty: 20,
    unit: "kg",
  },
  {
    title: "Farm Premium — Carrots (bulk)",
    item: "carrot",
    description: `${DEMO_MARKER} Premium carrots, large lot.`,
    price: 9.5,
    qty: 80,
    unit: "kg",
  },
  {
    title: "Farm Value — Baby Carrots",
    item: "baby carrot",
    description: `${DEMO_MARKER} Baby carrots (substitute overlap).`,
    price: 1.4,
    qty: 200,
    unit: "kg",
  },
  {
    title: "Farm Mid — Cucumbers",
    item: "cucumber",
    description: `${DEMO_MARKER} Standard cucumbers, limited lot.`,
    price: 4.5,
    qty: 8,
    unit: "kg",
  },
  {
    title: "Farm Premium — Cucumbers (bulk)",
    item: "cucumber",
    description: `${DEMO_MARKER} Premium cucumbers, large lot.`,
    price: 11.0,
    qty: 60,
    unit: "kg",
  },
  {
    title: "Farm Value — Persian Cucumbers",
    item: "persian cucumber",
    description: `${DEMO_MARKER} Persian / mini type (substitute overlap).`,
    price: 1.6,
    qty: 120,
    unit: "kg",
  },
];

async function ensureUserLocation(userId: mongoose.Types.ObjectId) {
  const u = await User.findById(userId).select("latLng postalCode");
  if (!u) throw new Error("User not found");
  if (!u.latLng || u.latLng.length !== 2 || !u.postalCode) {
    await User.findByIdAndUpdate(userId, {
      latLng: TORONTO_LATLNG,
      postalCode: TORONTO_POSTAL,
    });
    console.log(`Updated ${userId.toString()} with default Toronto latLng/postal for listings.`);
  }
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(uri);

  const farmA = await User.findOne({ email: FARM_A_EMAIL.toLowerCase() });
  const farmB = await User.findOne({ email: FARM_B_EMAIL.toLowerCase() });
  if (!farmA) {
    console.error(`User not found: ${FARM_A_EMAIL}`);
    process.exit(1);
  }
  if (!farmB) {
    console.error(`User not found: ${FARM_B_EMAIL}`);
    process.exit(1);
  }
  if (farmA.role !== "farmer" || farmB.role !== "farmer") {
    console.error("Both accounts must be farmers.");
    process.exit(1);
  }

  await ensureUserLocation(farmA._id as mongoose.Types.ObjectId);
  await ensureUserLocation(farmB._id as mongoose.Types.ObjectId);

  const farmARefreshed = await User.findById(farmA._id).lean();
  const farmBRefreshed = await User.findById(farmB._id).lean();
  if (!farmARefreshed?.latLng || !farmBRefreshed?.latLng) {
    throw new Error("Users still missing latLng after ensure.");
  }

  const ids = [farmA._id, farmB._id];
  const removed = await Listing.deleteMany({
    type: "supply",
    createdBy: { $in: ids },
    description: { $regex: DEMO_MARKER },
  });
  console.log(`Removed ${removed.deletedCount} prior demo listing(s).`);

  const batch: Array<{
    type: "supply";
    status: "open";
    title: string;
    item: string;
    description: string;
    price: number;
    qty: number;
    unit: "kg";
    latLng: [number, number];
    postalCode: string;
    createdBy: mongoose.Types.ObjectId;
    photos: [];
    dynamicPricing: boolean;
    matchedResponseId: null;
    responses: [];
  }> = [];

  for (const row of LISTINGS_FARM_A) {
    batch.push({
      type: "supply" as const,
      status: "open" as const,
      title: row.title,
      item: row.item,
      description: row.description,
      price: row.price,
      qty: row.qty,
      unit: row.unit,
      latLng: farmARefreshed.latLng as [number, number],
      postalCode: farmARefreshed.postalCode ?? TORONTO_POSTAL,
      createdBy: farmA._id,
      photos: [],
      dynamicPricing: false,
      matchedResponseId: null,
      responses: [],
    });
  }

  for (const row of LISTINGS_FARM_B) {
    batch.push({
      type: "supply" as const,
      status: "open" as const,
      title: row.title,
      item: row.item,
      description: row.description,
      price: row.price,
      qty: row.qty,
      unit: row.unit,
      latLng: farmBRefreshed.latLng as [number, number],
      postalCode: farmBRefreshed.postalCode ?? TORONTO_POSTAL,
      createdBy: farmB._id,
      photos: [],
      dynamicPricing: false,
      matchedResponseId: null,
      responses: [],
    });
  }

  const inserted = await Listing.insertMany(batch);
  console.log(`Inserted ${inserted.length} demo supply listings.`);
  console.log(`  ${FARM_A_EMAIL}: ${LISTINGS_FARM_A.length} listings (tomato + spinach)`);
  console.log(`  ${FARM_B_EMAIL}: ${LISTINGS_FARM_B.length} listings (carrot + cucumber)`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
