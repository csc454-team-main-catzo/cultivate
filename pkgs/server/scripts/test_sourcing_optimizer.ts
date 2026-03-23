import Listing from "../src/models/Listing.js";
import ProduceItem from "../src/models/ProduceItem.js";
import {
  runSourcingOptimizer,
  type OptimizationRequest,
  type SourcingPlan,
} from "../src/services/sourcingOptimizer.js";

type RawListing = {
  _id: string;
  type: "supply";
  status: "open";
  title: string;
  item: string;
  description?: string;
  price: number;
  qty: number;
  unit: "kg" | "lb" | "count" | "bunch";
  deliveryWindow?: { startAt: string; endAt: string };
  photos?: Array<{ imageId?: string }>;
  createdBy: { _id: string; name: string; role: "farmer" };
};

type ProduceTaxonomyItem = {
  _id: string;
  name: string;
  canonical: string;
  synonyms: string[];
  priority: number;
  active: boolean;
};

const FIXTURES = {
  listings: [
    {
      _id: "l-carrot-cheap",
      type: "supply",
      status: "open",
      title: "Bulk Carrots",
      item: "carrot",
      description: "Fresh carrots from local farm",
      price: 2.0,
      qty: 40,
      unit: "kg",
      deliveryWindow: {
        startAt: "2026-03-21T08:00:00.000Z",
        endAt: "2026-03-21T12:00:00.000Z",
      },
      createdBy: { _id: "f-1", name: "Farm A", role: "farmer" },
      photos: [{ imageId: "img-1" }],
    },
    {
      _id: "l-carrot-fast",
      type: "supply",
      status: "open",
      title: "Premium Carrots",
      item: "carrot",
      description: "Same-day delivery carrots",
      price: 3.2,
      qty: 50,
      unit: "kg",
      deliveryWindow: {
        startAt: "2026-03-20T09:00:00.000Z",
        endAt: "2026-03-20T11:00:00.000Z",
      },
      createdBy: { _id: "f-2", name: "Farm B", role: "farmer" },
      photos: [{ imageId: "img-2" }],
    },
    {
      _id: "l-carrot-lb",
      type: "supply",
      status: "open",
      title: "Carrots (lb)",
      item: "carrot",
      description: "Weight listed in pounds",
      price: 1.1,
      qty: 100,
      unit: "lb",
      deliveryWindow: {
        startAt: "2026-03-21T06:00:00.000Z",
        endAt: "2026-03-21T09:00:00.000Z",
      },
      createdBy: { _id: "f-3", name: "Farm C", role: "farmer" },
      photos: [{ imageId: "img-3" }],
    },
    {
      _id: "l-tomato-cheap",
      type: "supply",
      status: "open",
      title: "Field Tomato",
      item: "tomato",
      description: "Affordable tomato bulk lot",
      price: 2.8,
      qty: 40,
      unit: "kg",
      deliveryWindow: {
        startAt: "2026-03-21T10:00:00.000Z",
        endAt: "2026-03-21T14:00:00.000Z",
      },
      createdBy: { _id: "f-1", name: "Farm A", role: "farmer" },
      photos: [{ imageId: "img-4" }],
    },
    {
      _id: "l-roma-tomato",
      type: "supply",
      status: "open",
      title: "Roma Tomato",
      item: "roma tomato",
      description: "Substitute type for tomato",
      price: 3.0,
      qty: 25,
      unit: "kg",
      deliveryWindow: {
        startAt: "2026-03-22T10:00:00.000Z",
        endAt: "2026-03-22T13:00:00.000Z",
      },
      createdBy: { _id: "f-4", name: "Farm D", role: "farmer" },
      photos: [{ imageId: "img-5" }],
    },
    {
      _id: "l-spinach",
      type: "supply",
      status: "open",
      title: "Baby Spinach",
      item: "spinach",
      description: "Leafy greens",
      price: 4.0,
      qty: 15,
      unit: "kg",
      deliveryWindow: {
        startAt: "2026-03-21T12:00:00.000Z",
        endAt: "2026-03-21T16:00:00.000Z",
      },
      createdBy: { _id: "f-5", name: "Farm E", role: "farmer" },
      photos: [{ imageId: "img-6" }],
    },
    {
      _id: "l-arugula",
      type: "supply",
      status: "open",
      title: "Arugula",
      item: "arugula",
      description: "Could substitute for spinach",
      price: 3.7,
      qty: 12,
      unit: "kg",
      deliveryWindow: {
        startAt: "2026-03-22T09:00:00.000Z",
        endAt: "2026-03-22T12:00:00.000Z",
      },
      createdBy: { _id: "f-4", name: "Farm D", role: "farmer" },
      photos: [{ imageId: "img-7" }],
    },
  ] as RawListing[],
  produceItems: [
    {
      _id: "p-carrot",
      name: "Carrot",
      canonical: "carrot",
      synonyms: ["carrots"],
      priority: 1,
      active: true,
    },
    {
      _id: "p-tomato",
      name: "Tomato",
      canonical: "tomato",
      synonyms: ["roma tomato", "cherry tomato", "tomatoes"],
      priority: 1,
      active: true,
    },
    {
      _id: "p-spinach",
      name: "Spinach",
      canonical: "spinach",
      synonyms: ["baby spinach", "greens"],
      priority: 1,
      active: true,
    },
    {
      _id: "p-arugula",
      name: "Arugula",
      canonical: "arugula",
      synonyms: ["rocket"],
      priority: 1,
      active: true,
    },
  ] as ProduceTaxonomyItem[],
};

function buildListingQuery(listings: RawListing[], query: Record<string, unknown>) {
  let rows = listings.filter((l) => l.type === "supply" && l.status === "open");
  const orClauses = query.$or as Array<Record<string, unknown>> | undefined;
  if (orClauses && Array.isArray(orClauses)) {
    rows = rows.filter((row) => {
      return orClauses.some((clause: Record<string, unknown>) => {
        const field = Object.keys(clause ?? {})[0] as keyof RawListing | undefined;
        const matcher = field ? (clause as Record<string, unknown>)[field as string] : null;
        if (!(matcher instanceof RegExp) || !field) return false;
        const val = String(row[field] ?? "");
        return matcher.test(val);
      });
    });
  }
  return {
    populate: () => ({
      sort: () => ({
        limit: (n: number) => ({
          lean: async () => rows.slice(0, Math.max(0, n)),
        }),
      }),
    }),
  };
}

function installMocks() {
  const originalListingFind = Listing.find.bind(Listing);
  const originalProduceFind = ProduceItem.find.bind(ProduceItem);

  // Prevent LLM calls for deterministic local tests.
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GLEAN_LLM_MODEL;

  (Listing as unknown as { find: (query: Record<string, unknown>) => unknown }).find = (
    query: Record<string, unknown>
  ) => buildListingQuery(FIXTURES.listings, query);

  (
    ProduceItem as unknown as {
      find: () => { lean: () => Promise<ProduceTaxonomyItem[]> };
    }
  ).find = () => ({
    lean: async () => FIXTURES.produceItems,
  });

  return () => {
    (Listing as unknown as { find: typeof originalListingFind }).find = originalListingFind;
    (ProduceItem as unknown as { find: typeof originalProduceFind }).find = originalProduceFind;
  };
}

type Scenario = {
  name: string;
  request: OptimizationRequest;
  assert: (plan: SourcingPlan) => { pass: boolean; note: string };
};

function scenarioSet(): Scenario[] {
  return [
    {
      name: "Common demand: multi-item, multi-supplier coverage",
      request: {
        lineItems: [
          { item: "carrot", qtyNeeded: 60, unit: "kg" },
          { item: "tomato", qtyNeeded: 30, unit: "kg" },
        ],
      },
      assert: (plan) => {
        const ok =
          plan.strategies.length >= 3 &&
          plan.strategies[0]?.metrics.coveragePercent >= 95 &&
          plan.strategyOptions.length >= 3;
        return {
          pass: ok,
          note: `strategies=${plan.strategies.length}, topCoverage=${plan.strategies[0]?.metrics.coveragePercent ?? 0}%`,
        };
      },
    },
    {
      name: "Constraint: max total budget forces partial fill",
      request: {
        lineItems: [
          { item: "carrot", qtyNeeded: 60, unit: "kg" },
          { item: "tomato", qtyNeeded: 30, unit: "kg" },
        ],
        constraints: { maxTotalBudget: 120, prioritize: "cost" },
      },
      assert: (plan) => {
        const top = plan.strategies[0];
        const ok =
          Boolean(top) &&
          top.metrics.totalCost <= 120.01 &&
          (top.metrics.coveragePercent < 100 || plan.unfulfillable.length > 0);
        return {
          pass: ok,
          note: `topCost=${top?.metrics.totalCost ?? 0}, topCoverage=${top?.metrics.coveragePercent ?? 0}%, unfulfillable=${plan.unfulfillable.length}`,
        };
      },
    },
    {
      name: "Constraint: per-item price cap excludes expensive listings",
      request: {
        lineItems: [{ item: "carrot", qtyNeeded: 50, unit: "kg", maxPricePerUnit: 2.5 }],
      },
      assert: (plan) => {
        const top = plan.strategies[0];
        const violates = (top?.allocations ?? []).some((a) => a.supplier.pricePerUnit > 2.5);
        return {
          pass: Boolean(top) && !violates,
          note: `allocations=${top?.allocations.length ?? 0}, violatesPriceCap=${violates}`,
        };
      },
    },
    {
      name: "Unit conversion: fulfill kg demand from lb supply",
      request: {
        lineItems: [{ item: "carrot", qtyNeeded: 38, unit: "kg" }],
      },
      assert: (plan) => {
        const top = plan.strategies[0];
        const hasLbSource = (top?.allocations ?? []).some(
          (a) => a.supplier.listingId === "l-carrot-lb"
        );
        return {
          pass: Boolean(top) && top.metrics.coveragePercent >= 99 && hasLbSource,
          note: `topCoverage=${top?.metrics.coveragePercent ?? 0}%, usesLbSupply=${hasLbSource}`,
        };
      },
    },
    {
      name: "Speed priority + delivery window should reorder ranking",
      request: {
        lineItems: [{ item: "carrot", qtyNeeded: 25, unit: "kg" }],
        constraints: {
          prioritize: "speed",
          preferredDeliveryWindow: {
            startAt: "2026-03-20T08:00:00.000Z",
            endAt: "2026-03-20T12:00:00.000Z",
          },
        },
      },
      assert: (plan) => {
        const top = plan.strategies[0];
        const ok = Boolean(top) && top.name === "Fastest Delivery";
        return {
          pass: ok,
          note: `topStrategy=${top?.name ?? "none"}`,
        };
      },
    },
    {
      name: "No substitutes allowed should avoid related produce",
      request: {
        lineItems: [{ item: "kale", qtyNeeded: 10, unit: "kg", acceptSubstitutes: false }],
      },
      assert: (plan) => {
        const top = plan.strategies[0];
        const hasAlloc = (top?.allocations?.length ?? 0) > 0;
        return {
          pass: !hasAlloc && plan.unfulfillable.length >= 1,
          note: `allocations=${top?.allocations.length ?? 0}, unfulfillable=${plan.unfulfillable.length}`,
        };
      },
    },
    {
      name: "Edge case: empty supply universe should fail gracefully",
      request: {
        lineItems: [{ item: "dragon fruit", qtyNeeded: 5, unit: "kg" }],
      },
      assert: (plan) => {
        const ok = plan.strategies.length === 0 && plan.summary.length > 0;
        return { pass: ok, note: `strategies=${plan.strategies.length}, summary="${plan.summary}"` };
      },
    },
    {
      name: "Gap check: maxSuppliers constraint currently enforced",
      request: {
        lineItems: [
          { item: "carrot", qtyNeeded: 80, unit: "kg" },
          { item: "tomato", qtyNeeded: 35, unit: "kg" },
        ],
        constraints: { maxSuppliers: 1 },
      },
      assert: (plan) => {
        const topSuppliers = plan.strategies[0]?.metrics.supplierCount ?? 0;
        const enforced = topSuppliers <= 1;
        return {
          pass: enforced,
          note: `topSupplierCount=${topSuppliers}`,
        };
      },
    },
  ];
}

function summarizePlan(plan: SourcingPlan): string {
  const top = plan.strategies[0];
  if (!top) return "no strategy";
  return `${top.name} | coverage=${top.metrics.coveragePercent}% | cost=$${top.metrics.totalCost.toFixed(
    2
  )} | suppliers=${top.metrics.supplierCount}`;
}

async function main() {
  const restore = installMocks();
  try {
    const scenarios = scenarioSet();
    let passed = 0;
    let failed = 0;

    console.log("=== Sourcing Optimizer Deterministic Test Run ===");
    console.log(`Scenarios: ${scenarios.length}\n`);

    for (const [idx, s] of scenarios.entries()) {
      const plan = await runSourcingOptimizer(s.request);
      const result = s.assert(plan);
      const badge = result.pass ? "PASS" : "FAIL";
      if (result.pass) passed += 1;
      else failed += 1;
      console.log(`[${idx + 1}/${scenarios.length}] ${badge} - ${s.name}`);
      console.log(`  Top: ${summarizePlan(plan)}`);
      console.log(`  Check: ${result.note}`);
      console.log(
        `  Options: ${plan.strategyOptions
          .map((o) => `${o.rank}:${o.name}`)
          .join(", ") || "none"}`
      );
      console.log("");
    }

    console.log("=== Summary ===");
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    restore();
  }
}

main().catch((err) => {
  console.error("Test harness failed:", err);
  process.exit(1);
});
