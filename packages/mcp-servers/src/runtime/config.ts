import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive(),
  CHECKOUT_BASE_URL: z.string().url(),
  MCP_BEARER_TOKEN: z.string().min(16).optional(),
  CHECKOUT_ADMIN_TOKEN: z.string().min(8).optional(),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

export type RuntimeConfig = z.infer<typeof schema>;

export function loadRuntimeConfig(
  defaults: Partial<Record<keyof RuntimeConfig, string>>,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const merged = { ...defaults, ...stripUndefined(env) };
  const parsed = schema.safeParse(merged);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid MCP server configuration -> ${detail}`);
  }
  return parsed.data;
}

function stripUndefined(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && value.length > 0) {
      out[key] = value;
    }
  }
  return out;
}
