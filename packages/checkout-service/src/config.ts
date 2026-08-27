import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  SERVICE_NAME: z.string().min(1).default("checkout"),
  DATABASE_PATH: z.string().min(1).default("./data/checkout.sqlite"),
  ADMIN_TOKEN: z.string().min(8),
  REPLAY_TOKEN: z.string().min(16),
  LOG_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid checkout-service configuration -> ${detail}`);
  }
  return parsed.data;
}
