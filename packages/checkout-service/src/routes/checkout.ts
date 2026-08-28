import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { activeDeployRecord, recordRequestSample } from "../db.js";
import type { Db } from "../db.js";
import type { Logger } from "../logger.js";
import {
  MAX_LINE_ITEMS,
  MAX_QUANTITY,
  MAX_UNIT_PRICE_CENTS,
  isKnownDiscountCode,
} from "../pricing.js";
import { resolveVariant } from "../variants.js";
import type { PricedCheckout } from "../variants.js";
import type { CheckoutRequest } from "../types.js";

const itemSchema = z.object({
  sku: z.string().min(1).max(64),
  quantity: z.number().int().positive().max(MAX_QUANTITY),
  unitPriceCents: z.number().int().nonnegative().max(MAX_UNIT_PRICE_CENTS),
});

const bodySchema = z.object({
  cartId: z.string().min(1).max(64),
  items: z.array(itemSchema).min(1).max(MAX_LINE_ITEMS),
  discountCode: z.string().min(1).max(32).optional(),
  currency: z.string().length(3).default("USD"),
});

const SAMPLE_RETENTION = 500;

export function checkoutRouter(db: Db, logger: Logger): Router {
  const router = Router();

  const sample = (version: string, request: CheckoutRequest, statusCode: number): void => {
    try {
      recordRequestSample(
        db,
        {
          ts: new Date().toISOString(),
          version,
          payload: JSON.stringify(request),
          status_code: statusCode,
        },
        SAMPLE_RETENTION,
      );
    } catch {
      return;
    }
  };

  router.post("/checkout", (req, res) => {
    const requestId = randomUUID();
    const startedAt = process.hrtime.bigint();
    const active = activeDeployRecord(db);

    if (!active) {
      res.status(503).json({ error: "no_active_deploy", requestId });
      return;
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      const latencyMs = elapsedMs(startedAt);
      logger.warn(active.version, "checkout rejected: invalid payload", {
        requestId,
        statusCode: 400,
        latencyMs,
        attributes: { issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
      });
      res.status(400).json({ error: "invalid_request", requestId });
      return;
    }

    const request: CheckoutRequest = parsed.data;

    if (request.discountCode && !isKnownDiscountCode(request.discountCode)) {
      const latencyMs = elapsedMs(startedAt);
      logger.warn(active.version, "checkout rejected: unknown discount code", {
        requestId,
        statusCode: 422,
        latencyMs,
        attributes: { discountCode: request.discountCode },
      });
      res.status(422).json({ error: "unknown_discount_code", requestId });
      return;
    }

    let priced: PricedCheckout;
    try {
      priced = resolveVariant(active.variant)(request);
    } catch (error) {
      const latencyMs = elapsedMs(startedAt);
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof RangeError) {
        logger.warn(active.version, `checkout rejected: ${message}`, {
          requestId,
          statusCode: 400,
          latencyMs,
          attributes: { cartId: request.cartId },
        });
        res.status(400).json({ error: "cart_total_out_of_range", requestId });
        return;
      }
      logger.error(active.version, `checkout failed during payment authorization: ${message}`, {
        requestId,
        statusCode: 500,
        latencyMs,
        attributes: {
          cartId: request.cartId,
          discountApplied: Boolean(request.discountCode),
          variant: active.variant,
        },
      });
      sample(active.version, request, 500);
      res.status(500).json({ error: "payment_authorization_failed", requestId });
      return;
    }

    const latencyMs = elapsedMs(startedAt);
    logger.info(active.version, "checkout authorized", {
      requestId,
      statusCode: 200,
      latencyMs,
      attributes: {
        cartId: request.cartId,
        discountApplied: Boolean(request.discountCode),
        payableCents: priced.payableCents,
      },
    });
    sample(active.version, request, 200);
    res.status(200).json({
      orderId: randomUUID(),
      subtotalCents: priced.subtotalCents,
      discountCents: priced.discountCents,
      payableCents: priced.payableCents,
      currency: request.currency,
      authorizedAt: new Date().toISOString(),
    });
  });

  return router;
}

function elapsedMs(startedAt: bigint): number {
  return Math.max(1, Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000));
}
