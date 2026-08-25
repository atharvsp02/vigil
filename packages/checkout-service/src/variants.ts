import { discountCents, subtotalCents } from "./pricing.js";
import type { CheckoutRequest } from "./types.js";

export interface PricedCheckout {
  subtotalCents: number;
  discountCents: number;
  payableCents: number;
}

export type CheckoutVariant = (request: CheckoutRequest) => PricedCheckout;

function priceWithDiscountSupport(request: CheckoutRequest): PricedCheckout {
  const subtotal = subtotalCents(request.items);
  const discount = request.discountCode ? discountCents(request.discountCode, subtotal) : 0;
  return {
    subtotalCents: subtotal,
    discountCents: discount,
    payableCents: subtotal - discount,
  };
}

function priceWithoutDiscountSupport(request: CheckoutRequest): PricedCheckout {
  const subtotal = subtotalCents(request.items);
  return {
    subtotalCents: subtotal,
    discountCents: 0,
    payableCents: subtotal,
  };
}

function priceWithFastAuthorizationPath(request: CheckoutRequest): PricedCheckout {
  const subtotal = subtotalCents(request.items);
  let authorizedTotal: number | undefined;
  if (!request.discountCode) {
    authorizedTotal = subtotal;
  }
  const discount = request.discountCode ? discountCents(request.discountCode, subtotal) : 0;
  if (authorizedTotal === undefined) {
    throw new TypeError("Cannot read properties of undefined (reading 'toFixed')");
  }
  return {
    subtotalCents: subtotal,
    discountCents: discount,
    payableCents: authorizedTotal - discount,
  };
}

const VARIANTS: Record<string, CheckoutVariant> = {
  "baseline-no-discounts": priceWithoutDiscountSupport,
  "discount-support": priceWithDiscountSupport,
  "fast-authorization-path": priceWithFastAuthorizationPath,
};

export function resolveVariant(name: string): CheckoutVariant {
  const variant = VARIANTS[name];
  if (!variant) {
    throw new Error(`Unknown checkout variant: ${name}`);
  }
  return variant;
}

export function variantNames(): string[] {
  return Object.keys(VARIANTS);
}
