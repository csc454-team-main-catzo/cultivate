import { Annotation, StateGraph } from "@langchain/langgraph";
import type { OrderForBrief } from "../../mcp/types.js";
import type { ReceivingBriefSectionInput } from "../../mcp/types.js";
import type { ConfirmationRequested, DeviationFlagOutput } from "./state.js";
import {
  list_todays_orders,
  get_supplier_profile,
  get_supplier_trust,
  create_receiving_brief,
  send_supplier_confirmation_request,
  create_audit_log,
  auto_confirm_order,
} from "../../mcp/tools.js";
import { buildSectionForOrder } from "./briefBuilder.js";

// State schema for the Quality Gate graph
const QualityGateAnnotation = Annotation.Root({
  restaurantId: Annotation<string>(),
  date: Annotation<string>(),
  orders: Annotation<OrderForBrief[]>(),
  sections: Annotation<ReceivingBriefSectionInput[]>(),
  receivingBriefId: Annotation<string | null>(),
  confirmationsRequested: Annotation<ConfirmationRequested[]>({
    reducer: (left: ConfirmationRequested[], right: ConfirmationRequested[]) =>
      left.concat(Array.isArray(right) ? right : [right]),
    default: () => [],
  }),
  deviationFlags: Annotation<DeviationFlagOutput[]>(),
  error: Annotation<string | undefined>(),
});

type State = typeof QualityGateAnnotation.State;
type Update = typeof QualityGateAnnotation.Update;

async function fetchOrders(state: State): Promise<Update> {
  try {
    const orders = await list_todays_orders({
      restaurantId: state.restaurantId,
      date: state.date,
    });
    return { orders };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { orders: [], error: `fetch_orders: ${message}` };
  }
}

async function buildBrief(state: State): Promise<Update> {
  if (state.error || state.orders.length === 0) {
    return {};
  }
  try {
    const sections: ReceivingBriefSectionInput[] = [];
    for (const order of state.orders) {
      const profile = await get_supplier_profile({ supplierId: order.supplierId });
      const trust = await get_supplier_trust({ supplierId: order.supplierId });
      const section = await buildSectionForOrder(
        order,
        profile ?? null,
        trust ?? null
      );
      sections.push(section);
      await create_audit_log({
        eventType: "quality_gate.risk_scored",
        entityId: order._id,
        entityType: "Order",
        payload: {
          orderId: order._id,
          supplierId: order.supplierId,
          riskTier: section.riskTier,
          riskScore: section.riskScore,
        },
      });
    }
    const kitchenUiJson = {
      date: state.date,
      sections: sections.map((s) => ({
        supplierName: s.supplierName,
        orderId: s.orderId,
        riskTier: s.riskTier,
        confirmationStatus: s.confirmationStatus,
        trackingStatus: "",
        lineItems: s.lineItems.map((li) => ({
          itemDisplayName: li.itemDisplayName,
          expectedQty: li.expectedQty,
          unit: li.unit,
          packagingExpectation: li.packagingExpectation,
          quickQualityChecks: li.quickQualityChecks,
        })),
      })),
    };
    const receivingBriefId = await create_receiving_brief({
      restaurantId: state.restaurantId,
      date: state.date,
      brief: { sections, kitchenUiJson },
    });
    await create_audit_log({
      eventType: "quality_gate.brief_created",
      entityId: receivingBriefId,
      entityType: "ReceivingBrief",
      payload: {
        restaurantId: state.restaurantId,
        date: state.date,
        sectionCount: sections.length,
      },
    });
    return { sections, receivingBriefId };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: `build_brief: ${message}` };
  }
}

const CONFIRMATION_MESSAGE =
  "Please confirm: quantity, pack size, harvest date, and delivery window for this order.";
const CONFIRMATION_MESSAGE_HIGH =
  "Please confirm: quantity, pack size, harvest date, delivery window, and attach one photo (packed case label or harvest bin).";

async function requestConfirmations(state: State): Promise<Update> {
  if (state.error || !state.sections?.length) {
    return {};
  }
  const confirmationsRequested: ConfirmationRequested[] = [];
  for (const section of state.sections) {
    if (section.riskTier !== "MEDIUM" && section.riskTier !== "HIGH") continue;
    const requiredFields =
      section.riskTier === "HIGH"
        ? ["confirmQty", "packSize", "harvestDate", "deliveryWindow", "photoUrl"]
        : ["confirmQty", "packSize", "harvestDate", "deliveryWindow"];
    const message =
      section.riskTier === "HIGH"
        ? CONFIRMATION_MESSAGE_HIGH
        : CONFIRMATION_MESSAGE;
    await send_supplier_confirmation_request({
      orderId: section.orderId,
      supplierId: section.supplierId,
      message,
      requiredFields,
      riskTier: section.riskTier,
    });
    confirmationsRequested.push({
      orderId: section.orderId,
      supplierId: section.supplierId,
      riskTier: section.riskTier,
    });
    await create_audit_log({
      eventType: "quality_gate.confirmation_request_sent",
      entityId: section.orderId,
      entityType: "Order",
      payload: {
        orderId: section.orderId,
        supplierId: section.supplierId,
        riskTier: section.riskTier,
        requiredFields,
      },
    });
  }
  return { confirmationsRequested };
}

async function autoConfirm(state: State): Promise<Update> {
  if (state.error || !state.confirmationsRequested?.length || !state.orders?.length) {
    return {};
  }
  for (const c of state.confirmationsRequested) {
    const order = state.orders.find((o) => o._id === c.orderId);
    if (!order) continue;
    try {
      await auto_confirm_order({
        orderId: c.orderId,
        supplierId: c.supplierId,
        riskTier: c.riskTier,
        order,
        date: state.date,
      });
    } catch {
      // continue with other orders
    }
  }
  return {};
}

function buildGraph() {
  const graph = new StateGraph(QualityGateAnnotation)
    .addNode("fetch_orders", fetchOrders)
    .addNode("build_brief", buildBrief)
    .addNode("request_confirmations", requestConfirmations)
    .addNode("auto_confirm", autoConfirm)
    .addEdge("__start__", "fetch_orders")
    .addEdge("fetch_orders", "build_brief")
    .addEdge("build_brief", "request_confirmations")
    .addEdge("request_confirmations", "auto_confirm")
    .addEdge("auto_confirm", "__end__");
  return graph.compile();
}

let compiledGraph: ReturnType<typeof buildGraph> | null = null;

export function getQualityGateGraph() {
  if (!compiledGraph) compiledGraph = buildGraph();
  return compiledGraph;
}

export interface QualityGateRunResult {
  receivingBriefId: string | null;
  confirmationsRequested: ConfirmationRequested[];
  deviationFlags: DeviationFlagOutput[];
}

export async function runQualityGate(
  restaurantId: string,
  date: string
): Promise<QualityGateRunResult> {
  const graph = getQualityGateGraph();
  const result = await graph.invoke({
    restaurantId,
    date,
    orders: [],
    sections: [],
    receivingBriefId: null,
    confirmationsRequested: [],
    deviationFlags: [],
  });
  return {
    receivingBriefId: result.receivingBriefId ?? null,
    confirmationsRequested: result.confirmationsRequested ?? [],
    deviationFlags: result.deviationFlags ?? [],
  };
}
