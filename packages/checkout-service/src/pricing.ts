import type { CheckoutItem } from "./types.js";

const DISCOUNT_RATES: Record<string, number> = {
  SAVE10: 0.1,
  SAVE20: 0.2,
  WELCOME5: 0.05,
};

export const MAX_LINE_ITEMS = 100;
export const MAX_QUANTITY = 10_000;
export const MAX_UNIT_PRICE_CENTS = 100_000_000;
export const MAX_SUBTOTAL_CENTS = 1_000_000_000_000;

export function subtotalCents(items: CheckoutItem[]): number {
  const total = items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  if (!Number.isSafeInteger(total) || total > MAX_SUBTOTAL_CENTS) {
    throw new RangeError(`Cart subtotal exceeds the maximum supported value of ${MAX_SUBTOTAL_CENTS}`);
  }
  return total;
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
