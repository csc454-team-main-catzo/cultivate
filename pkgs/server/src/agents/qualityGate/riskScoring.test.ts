import { describe, it, expect } from "vitest";
import {
  computeOrderRisk,
  deliveryWindowHours,
  type OrderRiskInput,
} from "./riskScoring.js";

describe("deliveryWindowHours", () => {
  it("returns hours between start and end", () => {
    expect(
      deliveryWindowHours("2025-03-03T08:00:00.000Z", "2025-03-03T14:00:00.000Z")
    ).toBe(6);
    expect(
      deliveryWindowHours("2025-03-03T08:00:00.000Z", "2025-03-03T10:00:00.000Z")
    ).toBe(2);
  });

  it("returns 0 for invalid or reversed range", () => {
    expect(deliveryWindowHours("2025-03-03T14:00:00.000Z", "2025-03-03T08:00:00.000Z")).toBe(0);
  });
});

describe("computeOrderRisk", () => {
  it("returns LOW (0) when no signals", () => {
    const input: OrderRiskInput = {
      hasTrustRecord: true,
      reliability: 0.9,
      categories: ["vegetables"],
      deliveryWindowHours: 12,
      orderValueOrTotalQty: 10,
      supplierTypicalMax: 100,
    };
    const result = computeOrderRisk(input);
    expect(result.tier).toBe("LOW");
    expect(result.score).toBe(0);
  });

  it("returns LOW (1) for perishable only", () => {
    const input: OrderRiskInput = {
      hasTrustRecord: true,
      reliability: 0.9,
      categories: ["berries"],
      deliveryWindowHours: 12,
    };
    const result = computeOrderRisk(input);
    expect(result.tier).toBe("LOW");
    expect(result.score).toBe(1);
    expect(result.signals.perishableHighValue).toBe(true);
  });

  it("returns MEDIUM (2) for new supplier only", () => {
    const input: OrderRiskInput = {
      hasTrustRecord: false,
      categories: [],
      deliveryWindowHours: 12,
    };
    const result = computeOrderRisk(input);
    expect(result.tier).toBe("MEDIUM");
    expect(result.score).toBe(2);
    expect(result.signals.newSupplier).toBe(true);
  });

  it("returns MEDIUM (2) for prior issues only", () => {
    const input: OrderRiskInput = {
      hasTrustRecord: true,
      reliability: 0.5,
      categories: [],
      deliveryWindowHours: 12,
    };
    const result = computeOrderRisk(input);
    expect(result.tier).toBe("MEDIUM");
    expect(result.score).toBe(2);
    expect(result.signals.priorIssues).toBe(true);
  });

  it("returns MEDIUM (3) for new supplier + perishable", () => {
    const input: OrderRiskInput = {
      hasTrustRecord: false,
      categories: ["herbs"],
      deliveryWindowHours: 12,
    };
    const result = computeOrderRisk(input);
    expect(result.tier).toBe("MEDIUM");
    expect(result.score).toBe(3);
  });

  it("returns HIGH (4) for new supplier + priorIssues (impossible) or newSupplier + perishable + tightWindow", () => {
    const input: OrderRiskInput = {
      hasTrustRecord: false,
      categories: ["berries"],
      deliveryWindowHours: 4,
    };
    const result = computeOrderRisk(input);
    expect(result.tier).toBe("HIGH");
    expect(result.score).toBe(4); // 2 + 1 + 1
  });

  it("returns HIGH (5) for new supplier, perishable, tight window, big order", () => {
    const input: OrderRiskInput = {
      hasTrustRecord: false,
      categories: ["seafood"],
      deliveryWindowHours: 3,
      orderValueOrTotalQty: 200,
      supplierTypicalMax: 100,
    };
    const result = computeOrderRisk(input);
    expect(result.tier).toBe("HIGH");
    expect(result.score).toBe(5);
    expect(result.breakdown.length).toBeGreaterThan(0);
  });

  it("includes breakdown strings for audit", () => {
    const input: OrderRiskInput = {
      hasTrustRecord: false,
      categories: ["berries"],
      deliveryWindowHours: 2,
    };
    const result = computeOrderRisk(input);
    expect(result.breakdown).toContain("newSupplier: no trust history (+2)");
    expect(result.breakdown).toContain(
      "perishableHighValue: category in berries/herbs/seafood (+1)"
    );
    expect(result.breakdown).toContain("tightWindow: delivery window < 6h (+1)");
  });
});
