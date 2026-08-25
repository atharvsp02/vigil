import { Router } from "express";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { activeDeployRecord, findDeployRecord, setActiveDeploy } from "../db.js";
import type { Db } from "../db.js";
import type { Logger } from "../logger.js";

const activateParamsSchema = z.object({
  version: z.string().min(1),
});

const loadBodySchema = z.object({
  requests: z.number().int().positive().max(2000).default(200),
  discountRatio: z.number().min(0).max(1).default(0.35),
  concurrency: z.number().int().positive().max(50).default(10),
});

const DISCOUNT_CODES = ["SAVE10", "SAVE20", "WELCOME5"];

export interface AdminOptions {
  adminToken: string;
  selfBaseUrl: () => string;
}

export function adminRouter(db: Db, logger: Logger, options: AdminOptions): Router {
  const router = Router();

  router.use((req, res, next) => {
    const provided = req.header("x-admin-token");
    if (!provided || !constantTimeEqual(provided, options.adminToken)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  });

  router.post("/deploys/:version/activate", (req, res) => {
    const parsed = activateParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_version" });
      return;
    }
    const target = findDeployRecord(db, parsed.data.version);
    if (!target) {
      res.status(404).json({ error: "unknown_version", version: parsed.data.version });
      return;
    }
    const previous = activeDeployRecord(db);
    if (previous?.version === target.version) {
      res.status(200).json({
        changed: false,
        activeVersion: target.version,
        previousVersion: previous.version,
      });
      return;
    }
    setActiveDeploy(db, target.version);
    logger.warn(target.version, "active deploy changed", {
      attributes: {
        from: previous?.version ?? null,
        to: target.version,
        variant: target.variant,
      },
    });
    res.status(200).json({
      changed: true,
      activeVersion: target.version,
      previousVersion: previous?.version ?? null,
      variant: target.variant,
    });
  });

  router.post("/load", async (req, res) => {
    const parsed = loadBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
      return;
    }
    const { requests, discountRatio, concurrency } = parsed.data;
    const target = `${options.selfBaseUrl()}/checkout`;
    let succeeded = 0;
    let failed = 0;

    const plan = Array.from({ length: requests }, (_unused, index) => index);
    const workers = Array.from({ length: Math.min(concurrency, requests) }, async () => {
      while (plan.length > 0) {
        plan.pop();
        const withDiscount = Math.random() < discountRatio;
        const response = await fetch(target, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(syntheticCart(withDiscount)),
        }).catch(() => null);
        if (response && response.ok) {
          succeeded += 1;
        } else {
          failed += 1;
        }
      }
    });

    await Promise.all(workers);
    res.json({ requests, succeeded, failed });
  });

  return router;
}

function syntheticCart(withDiscount: boolean): Record<string, unknown> {
  const itemCount = 1 + Math.floor(Math.random() * 3);
  const items = Array.from({ length: itemCount }, (_unused, index) => ({
    sku: `SKU-${1000 + index}`,
    quantity: 1 + Math.floor(Math.random() * 2),
    unitPriceCents: 500 + Math.floor(Math.random() * 9500),
  }));
  const cart: Record<string, unknown> = {
    cartId: `cart_${Math.random().toString(36).slice(2, 10)}`,
    items,
    currency: "USD",
  };
  if (withDiscount) {
    const index = Math.floor(Math.random() * DISCOUNT_CODES.length);
    cart["discountCode"] = DISCOUNT_CODES[index] ?? "SAVE10";
  }
  return cart;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}
