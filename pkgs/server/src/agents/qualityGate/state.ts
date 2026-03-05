/**
 * Typed state for the Quality Gate LangGraph.
 */

import type { OrderForBrief } from "../../mcp/types.js";
import type { ReceivingBriefSectionInput } from "../../mcp/types.js";
import type { RiskTier } from "./riskScoring.js";

export interface ConfirmationRequested {
  orderId: string;
  supplierId: string;
  riskTier: RiskTier;
}

export interface DeviationFlagOutput {
  orderId: string;
  type: string;
  severity: string;
  suggestedAction: string;
}

export interface QualityGateState {
  restaurantId: string;
  date: string;
  orders: OrderForBrief[];
  sections: ReceivingBriefSectionInput[];
  receivingBriefId: string | null;
  confirmationsRequested: ConfirmationRequested[];
  deviationFlags: DeviationFlagOutput[];
  error?: string;
}

export const initialState = (
  restaurantId: string,
  date: string
): QualityGateState => ({
  restaurantId,
  date,
  orders: [],
  sections: [],
  receivingBriefId: null,
  confirmationsRequested: [],
  deviationFlags: [],
});
