/**
 * MCP tool parameter and result types for the Quality Gate agent.
 * Tools are implemented as async functions invoked by the LangGraph nodes.
 */

import type { Types } from "mongoose";

export interface ListTodaysOrdersParams {
  restaurantId: string;
  date: string; // YYYY-MM-DD
}

export interface OrderForBrief {
  _id: string;
  restaurantId: string;
  orderDate: string;
  supplierId: string;
  lineItems: Array<{
    itemCanonical: string;
    itemDisplayName: string;
    expectedQty: number;
    unit: string;
    packSize?: string;
    category?: string;
    substitutionRules?: string;
  }>;
  deliveryWindowStart: string;
  deliveryWindowEnd: string;
  status: string;
}

export interface GetSupplierProfileParams {
  supplierId: string;
}

export interface SupplierProfile {
  _id: string;
  name: string;
  typicalMaxOrderValue?: number;
}

export interface GetSupplierTrustParams {
  supplierId: string;
}

export interface SupplierTrust {
  supplierId: string;
  reliability: number;
  issueCount: number;
  lastUpdated: string;
}

export interface GetQualityTemplateParams {
  itemCanonical?: string;
  category?: string;
}

export interface QualityTemplate {
  key: string;
  keyType: "category" | "itemCanonical";
  quickQualityChecks: string[];
  defaultAcceptableVarianceQtyPercent?: number;
  defaultPackagingNote?: string;
}

export interface ReceivingBriefSectionInput {
  supplierId: string;
  supplierName: string;
  orderId: string;
  riskTier: "LOW" | "MEDIUM" | "HIGH";
  riskScore: number;
  confirmationStatus: "pending" | "confirmed" | "not_required";
  lineItems: Array<{
    itemCanonical: string;
    itemDisplayName: string;
    expectedQty: number;
    unit: string;
    packagingExpectation: string;
    acceptableVariance: string;
    quickQualityChecks: string[];
    substitutionRules: string;
    mismatchProcedure: string;
    confidence: string;
    assumptions: string;
  }>;
}

export interface CreateReceivingBriefParams {
  restaurantId: string;
  date: string; // YYYY-MM-DD
  brief: {
    sections: ReceivingBriefSectionInput[];
    kitchenUiJson?: Record<string, unknown>;
  };
}

export interface SendSupplierConfirmationRequestParams {
  orderId: string;
  supplierId: string;
  message: string;
  requiredFields: string[];
  riskTier: "LOW" | "MEDIUM" | "HIGH";
}

export interface SupplierConfirmationSnapshotInput {
  orderId: string;
  supplierId: string;
  riskTier: "LOW" | "MEDIUM" | "HIGH";
  confirmedQty?: string;
  confirmedPackSize?: string;
  harvestDate?: string;
  deliveryWindow?: string;
  photoUrl?: string;
  rawPayload: Record<string, unknown>;
}

export interface RecordSupplierConfirmationParams {
  orderId: string;
  supplierId: string;
  snapshot: SupplierConfirmationSnapshotInput;
}

export interface CreateAuditLogParams {
  eventType: string;
  entityId: string | Types.ObjectId;
  payload: Record<string, unknown>;
  entityType?: string;
}
