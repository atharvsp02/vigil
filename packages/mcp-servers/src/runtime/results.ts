import { CheckoutServiceError, CheckoutServiceUnreachableError } from "@vigil/checkout-client";

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function ok(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

export function failure(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export async function guard(work: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await work());
  } catch (error) {
    if (error instanceof CheckoutServiceError) {
      return failure(
        `The checkout service rejected the request (HTTP ${error.status}). Response body: ${error.body}`,
      );
    }
    if (error instanceof CheckoutServiceUnreachableError) {
      return failure(
        `The checkout service is unreachable: ${error.message}. Treat this as missing evidence rather than a healthy service.`,
      );
    }
    return failure(error instanceof Error ? error.message : String(error));
  }
}
