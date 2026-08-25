import type { CheckoutItem } from "./types.js";

const DISCOUNT_RATES: Record<string, number> = {
  SAVE10: 0.1,
  SAVE20: 0.2,
  WELCOME5: 0.05,
};

export function subtotalCents(items: CheckoutItem[]): number {
  return items.reduce((total, item) => total + item.unitPriceCents * item.quantity, 0);
}

export function discountRate(code: string): number {
  return DISCOUNT_RATES[code.toUpperCase()] ?? 0;
}

export function discountCents(code: string, subtotal: number): number {
  return Math.round(subtotal * discountRate(code));
}

export function isKnownDiscountCode(code: string): boolean {
  return code.toUpperCase() in DISCOUNT_RATES;
}
