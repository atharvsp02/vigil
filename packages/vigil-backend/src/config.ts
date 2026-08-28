import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4200),
  HARNESS_BASE_URL: z.string().url().default("http://127.0.0.1:8790"),
  HARNESS_MODEL: z.string().min(1).default("google-gemini/gemini-3-5-flash-lite"),
  CHECKOUT_BASE_URL: z.string().url().default("http://127.0.0.1:4000"),
  CHECKOUT_ADMIN_TOKEN: z.string().min(8),
  OBSERVABILITY_MCP_SERVER: z.string().min(1).default("vigil-observability"),
  DEPLOYS_MCP_SERVER: z.string().min(1).default("vigil-deploys"),
  DASHBOARD_ORIGIN: z
    .string()
    .min(1)
    .default("http://localhost:3000,http://127.0.0.1:3000"),
  TURN_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000),
});

export type Config = z.infer<typeof schema>;

export function dashboardOrigins(config: Config): string[] {
  return config.DASHBOARD_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid vigil-backend configuration -> ${detail}`);
  }
  return parsed.data;
}
