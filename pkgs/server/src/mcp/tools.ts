/**
 * MCP tool adapter: async functions that LangGraph nodes call to access data and actions.
 * No external MCP server process; these run in-process with the server.
 */

import mongoose from "mongoose";
import Order from "../models/Order.js";
import type { IOrderLineItem } from "../models/Order.js";
import Supplier from "../models/Supplier.js";
import SupplierTrust from "../models/SupplierTrust.js";
import QualityTemplate from "../models/QualityTemplate.js";
import ReceivingBrief from "../models/ReceivingBrief.js";
import SupplierConfirmationRequest from "../models/SupplierConfirmationRequest.js";
import SupplierConfirmationSnapshot from "../models/SupplierConfirmationSnapshot.js";
import AuditLog from "../models/AuditLog.js";
import type {
  ListTodaysOrdersParams,
  OrderForBrief,
  GetSupplierProfileParams,
  SupplierProfile,
  GetSupplierTrustParams,
  SupplierTrust as SupplierTrustType,
  GetQualityTemplateParams,
  QualityTemplate as QualityTemplateType,
  CreateReceivingBriefParams,
  SendSupplierConfirmationRequestParams,
  RecordSupplierConfirmationParams,
  CreateAuditLogParams,
} from "./types.js";

function toDateStart(dateStr: string): Date {
  const d = new Date(dateStr + "T00:00:00.000Z");
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${dateStr}`);
  return d;
}

function toDateEnd(dateStr: string): Date {
  const d = new Date(dateStr + "T23:59:59.999Z");
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${dateStr}`);
  return d;
}

export async function list_todays_orders(
  params: ListTodaysOrdersParams
): Promise<OrderForBrief[]> {
  const start = toDateStart(params.date);
  const end = toDateEnd(params.date);
  const orders = await Order.find({
    restaurantId: params.restaurantId,
    orderDate: { $gte: start, $lte: end },
    status: { $in: ["placed", "confirmed"] },
  })
    .lean()
    .exec();
  return orders.map((o) => ({
    _id: String(o._id),
    restaurantId: String(o.restaurantId),
    orderDate: o.orderDate.toISOString(),
    supplierId: String(o.supplierId),
    lineItems: o.lineItems.map((li: IOrderLineItem) => ({
      itemCanonical: li.itemCanonical,
      itemDisplayName: li.itemDisplayName,
      expectedQty: li.expectedQty,
      unit: li.unit,
      packSize: li.packSize,
      category: li.category,
      substitutionRules: li.substitutionRules,
    })),
    deliveryWindowStart: o.deliveryWindowStart.toISOString(),
    deliveryWindowEnd: o.deliveryWindowEnd.toISOString(),
    status: o.status,
  }));
}

export async function get_supplier_profile(
  params: GetSupplierProfileParams
): Promise<SupplierProfile | null> {
  const s = await Supplier.findById(params.supplierId).lean().exec();
  if (!s) return null;
  return {
    _id: String(s._id),
    name: s.name,
    typicalMaxOrderValue: s.typicalMaxOrderValue,
  };
}

export async function get_supplier_trust(
  params: GetSupplierTrustParams
): Promise<SupplierTrustType | null> {
  const t = await SupplierTrust.findOne({ supplierId: params.supplierId })
    .lean()
    .exec();
  if (!t) return null;
  return {
    supplierId: String(t.supplierId),
    reliability: t.reliability,
    issueCount: t.issueCount,
    lastUpdated: t.lastUpdated.toISOString(),
  };
}

export async function get_quality_template(
  params: GetQualityTemplateParams
): Promise<QualityTemplateType | null> {
  const key = params.itemCanonical ?? params.category;
  if (!key) return null;
  const keyType = params.itemCanonical ? "itemCanonical" : "category";
  const t = await QualityTemplate.findOne({ key, keyType }).lean().exec();
  if (!t) return null;
  return {
    key: t.key,
    keyType: t.keyType,
    quickQualityChecks: t.quickQualityChecks,
    defaultAcceptableVarianceQtyPercent: t.defaultAcceptableVarianceQtyPercent,
    defaultPackagingNote: t.defaultPackagingNote,
  };
}

export async function create_receiving_brief(
  params: CreateReceivingBriefParams
): Promise<string> {
  const briefDate = toDateStart(params.date);
  const doc = await ReceivingBrief.create({
    restaurantId: params.restaurantId,
    briefDate,
    sections: params.brief.sections.map((sec) => ({
      supplierId: sec.supplierId,
      supplierName: sec.supplierName,
      orderId: sec.orderId,
      riskTier: sec.riskTier,
      riskScore: sec.riskScore,
      confirmationStatus: sec.confirmationStatus,
      lineItems: sec.lineItems,
    })),
    kitchenUiJson: params.brief.kitchenUiJson,
  });
  return String(doc._id);
}

export async function send_supplier_confirmation_request(
  params: SendSupplierConfirmationRequestParams
): Promise<void> {
  await SupplierConfirmationRequest.findOneAndUpdate(
    { orderId: params.orderId },
    {
      $set: {
        orderId: params.orderId,
        supplierId: params.supplierId,
        message: params.message,
        requiredFields: params.requiredFields,
        riskTier: params.riskTier,
        status: "pending",
      },
    },
    { upsert: true }
  ).exec();
}

export async function record_supplier_confirmation(
  params: RecordSupplierConfirmationParams
): Promise<void> {
  const snap = params.snapshot;
  await SupplierConfirmationSnapshot.findOneAndUpdate(
    { orderId: params.orderId },
    {
      $set: {
        orderId: params.orderId,
        supplierId: params.supplierId,
        riskTier: snap.riskTier,
        confirmedQty: snap.confirmedQty,
        confirmedPackSize: snap.confirmedPackSize,
        harvestDate: snap.harvestDate,
        deliveryWindow: snap.deliveryWindow,
        photoUrl: snap.photoUrl,
        rawPayload: snap.rawPayload ?? {},
        confirmedAt: new Date(),
      },
    },
    { upsert: true }
  ).exec();
  await SupplierConfirmationRequest.updateOne(
    { orderId: params.orderId },
    { $set: { status: "confirmed" } }
  ).exec();
}

export async function create_audit_log(params: CreateAuditLogParams): Promise<void> {
  await AuditLog.create({
    eventType: params.eventType,
    entityId: params.entityId,
    entityType: params.entityType,
    payload: params.payload ?? {},
  });
}

/** Auto-confirm an order using system-derived values (from order). Used when algorithm applies best-supplier confirmation. */
export async function auto_confirm_order(params: {
  orderId: string;
  supplierId: string;
  riskTier: string;
  order: OrderForBrief;
  date: string;
}): Promise<void> {
  const { orderId, supplierId, riskTier, order, date } = params;
  const first = order.lineItems[0];
  const start = new Date(order.deliveryWindowStart);
  const end = new Date(order.deliveryWindowEnd);
  const deliveryWindow = `${start.getUTCHours().toString().padStart(2, "0")}:${start.getUTCMinutes().toString().padStart(2, "0")}-${end.getUTCHours().toString().padStart(2, "0")}:${end.getUTCMinutes().toString().padStart(2, "0")}`;
  await record_supplier_confirmation({
    orderId,
    supplierId,
    snapshot: {
      orderId,
      supplierId,
      riskTier,
      confirmedQty: String(first?.expectedQty ?? 0),
      confirmedPackSize: first?.packSize ?? "—",
      harvestDate: date,
      deliveryWindow,
      photoUrl: riskTier === "HIGH" ? "system-auto-confirmed" : undefined,
      rawPayload: {},
    },
  });
  await ReceivingBrief.updateOne(
    { "sections.orderId": new mongoose.Types.ObjectId(orderId) },
    { $set: { "sections.$.confirmationStatus": "confirmed" } }
  ).exec();
  await ReceivingBrief.updateOne(
    { "sections.orderId": new mongoose.Types.ObjectId(orderId) },
    { $set: { "kitchenUiJson.sections.$[elem].confirmationStatus": "confirmed" } },
    { arrayFilters: [{ "elem.orderId": orderId }] }
  ).exec();
  await create_audit_log({
    eventType: "quality_gate.auto_confirmed",
    entityId: orderId,
    entityType: "Order",
    payload: { orderId, supplierId, riskTier },
  });
}

/** List all suppliers with trust (reliability). Used to pick best supplier for new orders. */
export async function list_suppliers_with_trust(): Promise<
  Array<{ _id: string; name: string; reliability: number }>
> {
  const suppliers = await Supplier.find().lean().exec();
  const result = await Promise.all(
    suppliers.map(async (s) => {
      const t = await SupplierTrust.findOne({ supplierId: s._id }).lean().exec();
      return {
        _id: String(s._id),
        name: s.name,
        reliability: t?.reliability ?? 0,
      };
    })
  );
  return result;
}
