import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import * as v from "valibot";
import { authMiddleware } from "../middleware/auth.js";
import type { AuthenticatedContext } from "../middleware/types.js";
import {
  runSourcingOptimizer,
  type OptimizationRequest,
  type SourcingPlan,
} from "../services/sourcingOptimizer.js";

const optimization = new Hono<AuthenticatedContext>();
const SUPPORTED_SHEET_MIME_TYPES = new Set([
  "text/csv",
  "application/csv",
  "text/plain",
]);

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const LineItemSchema = v.object({
  item: v.pipe(v.string(), v.minLength(1, "item is required")),
  qtyNeeded: v.pipe(v.number(), v.minValue(0.01, "qtyNeeded must be positive")),
  unit: v.optional(v.picklist(["kg", "lb", "count", "bunch"]), "kg"),
  maxPricePerUnit: v.optional(v.number()),
  acceptSubstitutes: v.optional(v.boolean()),
  notes: v.optional(v.string()),
});

const ConstraintsSchema = v.object({
  maxTotalBudget: v.optional(v.pipe(v.number(), v.minValue(0))),
  preferredDeliveryWindow: v.optional(
    v.object({
      startAt: v.string(),
      endAt: v.string(),
    })
  ),
  maxSuppliers: v.optional(v.pipe(v.number(), v.minValue(1))),
  prioritize: v.optional(v.picklist(["cost", "speed", "quality", "coverage"])),
});

const OptimizeBody = v.object({
  orderDescription: v.optional(v.string()),
  lineItems: v.optional(v.array(LineItemSchema)),
  constraints: v.optional(ConstraintsSchema),
});

async function readJson(c: unknown): Promise<unknown> {
  try {
    return await (c as { req: { json(): Promise<unknown> } }).req.json();
  } catch {
    return null;
  }
}

function normalizeSheetHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseBooleanCell(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  if (["true", "yes", "y", "1"].includes(normalized)) return true;
  if (["false", "no", "n", "0"].includes(normalized)) return false;
  return undefined;
}

function parseNumberCell(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const normalized = String(value ?? "").trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        cur += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseCsvRows(csv: string): string[][] {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map(parseCsvLine);
}

// ---------------------------------------------------------------------------
// POST /parse-sheet — Parse uploaded CSV into sourcing line items
// ---------------------------------------------------------------------------

optimization.post(
  "/parse-sheet",
  describeRoute({
    operationId: "parseSourcingSheet",
    summary: "Parse an uploaded CSV order sheet into structured line items",
    security: [{ bearerAuth: [] }, {}],
    responses: {
      200: { description: "Parsed line items from sheet rows" },
      400: { description: "Invalid file or no parseable rows" },
      415: { description: "Unsupported file format (CSV only)" },
    },
  }),
  authMiddleware({ optional: true }),
  async (c) => {
    try {
      let formData: FormData;
      try {
        formData = await c.req.formData();
      } catch {
        return c.json({ error: "Could not parse multipart form data" }, 400);
      }

      const file = formData.get("sheet");
      if (!(file instanceof File)) {
        return c.json({ error: "Missing sheet file in form-data field 'sheet'" }, 400);
      }

      const lowerName = file.name.toLowerCase();
      const byExtension = lowerName.endsWith(".csv");
      const byMime = !file.type || SUPPORTED_SHEET_MIME_TYPES.has(file.type);
      if (!byExtension && !byMime) {
        return c.json({ error: "Unsupported file format. Use .csv" }, 415);
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const csvText = new TextDecoder("utf-8").decode(buffer);
      const rows = parseCsvRows(csvText);
      if (!rows.length) {
        return c.json({ error: "CSV is empty" }, 400);
      }

      const headerRow = rows[0] ?? [];
      const headerMap = new Map<string, number>();
      headerRow.forEach((h, index) => {
        const normalized = normalizeSheetHeader(h);
        if (normalized) headerMap.set(normalized, index);
      });

      const itemIdx =
        headerMap.get("item") ??
        headerMap.get("product") ??
        headerMap.get("produce") ??
        headerMap.get("name");
      const qtyIdx =
        headerMap.get("qtyneeded") ??
        headerMap.get("qty") ??
        headerMap.get("quantity") ??
        headerMap.get("amount");
      const unitIdx = headerMap.get("unit");
      const maxPriceIdx =
        headerMap.get("maxpriceperunit") ??
        headerMap.get("maxprice") ??
        headerMap.get("maxunitprice") ??
        headerMap.get("pricecap");
      const acceptsSubIdx =
        headerMap.get("acceptsubstitutes") ??
        headerMap.get("substitutes") ??
        headerMap.get("allowsubstitutes");
      const notesIdx =
        headerMap.get("notes") ??
        headerMap.get("note") ??
        headerMap.get("requirements");

      if (itemIdx == null || qtyIdx == null) {
        return c.json(
          {
            error:
              "Could not detect required columns. Include at least 'item' and 'qty'/'quantity'.",
          },
          400
        );
      }

      const lineItems: Array<{
        item: string;
        qtyNeeded: number;
        unit: "kg" | "lb" | "count" | "bunch";
        maxPricePerUnit?: number;
        acceptSubstitutes?: boolean;
        notes?: string;
        sourceRow: number;
      }> = [];
      for (const [rowIndex, row] of rows.slice(1).entries()) {
        const item = String(row[itemIdx] ?? "").trim();
        const qtyNeeded = parseNumberCell(row[qtyIdx]);
        if (!item || qtyNeeded == null || qtyNeeded <= 0) continue;

        const unitRaw = String(row[unitIdx ?? -1] ?? "kg")
          .trim()
          .toLowerCase();
        const unit = ["kg", "lb", "count", "bunch"].includes(unitRaw)
          ? (unitRaw as "kg" | "lb" | "count" | "bunch")
          : "kg";

        lineItems.push({
          item,
          qtyNeeded,
          unit,
          maxPricePerUnit: parseNumberCell(row[maxPriceIdx ?? -1]),
          acceptSubstitutes: parseBooleanCell(row[acceptsSubIdx ?? -1]),
          notes: String(row[notesIdx ?? -1] ?? "").trim() || undefined,
          sourceRow: rowIndex + 2,
        });
      }

      if (lineItems.length === 0) {
        return c.json(
          { error: "No valid rows were parsed. Check item/qty columns." },
          400
        );
      }

      return c.json(
        {
          filename: file.name,
          sheet: "csv",
          parsedCount: lineItems.length,
          lineItems: lineItems.map(({ sourceRow, ...rest }) => rest),
          sourceRows: lineItems.map((r) => r.sourceRow),
        },
        200
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to parse sheet";
      return c.json({ error: message }, 500);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /optimize — Run the sourcing optimizer
// ---------------------------------------------------------------------------

optimization.post(
  "/optimize",
  describeRoute({
    operationId: "optimizeSourcing",
    summary:
      "Analyze an order and return ranked multi-supplier fulfillment strategies with partial-fill support and LLM-powered reasoning",
    security: [{ bearerAuth: [] }, {}],
    responses: {
      200: {
        description:
          "Sourcing plan with ranked strategies, allocations, unfulfillable items, and natural-language explanation",
      },
      400: { description: "Invalid request body" },
      500: { description: "Internal server error" },
    },
  }),
  authMiddleware({ optional: true }),
  async (c) => {
    try {
      const raw = await readJson(c);
      const parsed = v.safeParse(OptimizeBody, raw);
      if (!parsed.success) {
        return c.json({ error: "Invalid request body", details: parsed.issues }, 400);
      }
      const body = parsed.output;

      if (!body.orderDescription && (!body.lineItems || body.lineItems.length === 0)) {
        return c.json({ error: "Provide either orderDescription or lineItems" }, 400);
      }

      const request: OptimizationRequest = {
        orderDescription: body.orderDescription,
        lineItems: body.lineItems?.map((li) => ({
          item: li.item,
          qtyNeeded: li.qtyNeeded,
          unit: li.unit ?? "kg",
          maxPricePerUnit: li.maxPricePerUnit,
          acceptSubstitutes: li.acceptSubstitutes,
          notes: li.notes,
        })),
        constraints: body.constraints
          ? {
              maxTotalBudget: body.constraints.maxTotalBudget,
              preferredDeliveryWindow: body.constraints.preferredDeliveryWindow,
              maxSuppliers: body.constraints.maxSuppliers,
              prioritize: body.constraints.prioritize,
            }
          : undefined,
      };

      const plan: SourcingPlan = await runSourcingOptimizer(request);
      return c.json(plan, 200);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[Optimization] Route error:", message);
      return c.json({ error: message }, 500);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /optimize/explain — Re-explain an existing plan (e.g. after user edits)
// ---------------------------------------------------------------------------

const ExplainBody = v.object({
  strategyId: v.pipe(v.string(), v.minLength(1)),
  context: v.optional(v.string()),
});

optimization.post(
  "/optimize/explain",
  describeRoute({
    operationId: "explainStrategy",
    summary:
      "Generate a natural-language explanation for a specific fulfillment strategy",
    security: [{ bearerAuth: [] }, {}],
    responses: {
      200: { description: "Explanation text" },
      400: { description: "Invalid request body" },
    },
  }),
  authMiddleware({ optional: true }),
  async (c) => {
    try {
      const raw = await readJson(c);
      const parsed = v.safeParse(ExplainBody, raw);
      if (!parsed.success) {
        return c.json({ error: "Invalid request body", details: parsed.issues }, 400);
      }

      return c.json({
        strategyId: parsed.output.strategyId,
        explanation:
          "To get a full explanation, run the /optimize endpoint which includes LLM-generated reasoning for all strategies.",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: message }, 500);
    }
  }
);

export default optimization;
