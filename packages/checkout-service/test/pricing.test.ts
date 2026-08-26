import { describe, expect, it } from "vitest";
import { discountCents, discountRate, isKnownDiscountCode, subtotalCents } from "../src/pricing.js";

describe("subtotalCents", () => {
  it("multiplies unit price by quantity across line items", () => {
    const total = subtotalCents([
      { sku: "A", quantity: 2, unitPriceCents: 1000 },
      { sku: "B", quantity: 3, unitPriceCents: 250 },
    ]);
    expect(total).toBe(2750);
  });

  it("returns zero for an empty cart", () => {
    expect(subtotalCents([])).toBe(0);
  });
});

describe("discountRate", () => {
  it("is case insensitive", () => {
    expect(discountRate("save10")).toBe(0.1);
  });

  it("returns zero for unknown codes", () => {
    expect(discountRate("NOPE")).toBe(0);
  });
});

describe("discountCents", () => {
  it("rounds to the nearest cent", () => {
    expect(discountCents("WELCOME5", 999)).toBe(50);
  });
});

describe("isKnownDiscountCode", () => {
  it("accepts seeded codes and rejects others", () => {
    expect(isKnownDiscountCode("SAVE20")).toBe(true);
    expect(isKnownDiscountCode("FREESTUFF")).toBe(false);
  });
});
