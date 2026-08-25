import { describe, expect, it } from "vitest";
import { resolveVariant, variantNames } from "../src/variants.js";
import type { CheckoutRequest } from "../src/types.js";

const cart: CheckoutRequest = {
  cartId: "cart_1",
  currency: "USD",
  items: [{ sku: "A", quantity: 2, unitPriceCents: 1000 }],
};

const cartWithDiscount: CheckoutRequest = { ...cart, discountCode: "SAVE10" };

describe("resolveVariant", () => {
  it("throws on an unknown variant name", () => {
    expect(() => resolveVariant("does-not-exist")).toThrow(/Unknown checkout variant/);
  });

  it("exposes every seeded variant", () => {
    expect(variantNames()).toEqual([
      "baseline-no-discounts",
      "discount-support",
      "fast-authorization-path",
    ]);
  });
});

describe("baseline-no-discounts", () => {
  it("ignores discount codes entirely", () => {
    const priced = resolveVariant("baseline-no-discounts")(cartWithDiscount);
    expect(priced).toEqual({ subtotalCents: 2000, discountCents: 0, payableCents: 2000 });
  });
});

describe("discount-support", () => {
  it("prices carts without a discount", () => {
    const priced = resolveVariant("discount-support")(cart);
    expect(priced).toEqual({ subtotalCents: 2000, discountCents: 0, payableCents: 2000 });
  });

  it("applies the discount to the payable amount", () => {
    const priced = resolveVariant("discount-support")(cartWithDiscount);
    expect(priced).toEqual({ subtotalCents: 2000, discountCents: 200, payableCents: 1800 });
  });
});

describe("fast-authorization-path", () => {
  it("still prices carts without a discount", () => {
    const priced = resolveVariant("fast-authorization-path")(cart);
    expect(priced).toEqual({ subtotalCents: 2000, discountCents: 0, payableCents: 2000 });
  });

  it("fails whenever a discount code is present", () => {
    expect(() => resolveVariant("fast-authorization-path")(cartWithDiscount)).toThrow(TypeError);
  });
});
