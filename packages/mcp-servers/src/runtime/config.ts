import { z } from "zod";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

const schema = z
  .object({
    PORT: z.coerce.number().int().positive(),
    HOST: z.string().min(1).default("127.0.0.1"),
    CHECKOUT_BASE_URL: z.string().url(),
    MCP_BEARER_TOKEN: z.string().min(16).optional(),
    CHECKOUT_ADMIN_TOKEN: z.string().min(8).optional(),
    CHECKOUT_REPLAY_TOKEN: z.string().min(16).optional(),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  })
  .refine((config) => LOOPBACK_HOSTS.has(config.HOST) || config.MCP_BEARER_TOKEN, {
    message:
      "MCP_BEARER_TOKEN is required when HOST is not loopback: an unauthenticated MCP endpoint on a routable interface lets any network client reach its tools directly, bypassing the harness approval gate",
    path: ["MCP_BEARER_TOKEN"],
  });

export type RuntimeConfig = z.infer<typeof schema>;

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

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
