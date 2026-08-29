import { describe, expect, it } from "vitest";
import { HarnessClient, HarnessError, parseSse, sessionIdOf } from "../src/harness.js";
import { buildAgentSpec } from "../src/agent.js";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const frames: string[] = [];
  for await (const frame of parseSse(stream)) {
    frames.push(frame);
  }
  return frames;
}

describe("parseSse", () => {
  it("emits one payload per frame", async () => {
    const frames = await collect(streamOf(['data: {"a":1}\n\n', 'data: {"a":2}\n\n']));
    expect(frames).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("joins multi-line data fields", async () => {
    const frames = await collect(streamOf(["data: line one\ndata: line two\n\n"]));
    expect(frames).toEqual(["line one\nline two"]);
  });

  it("reassembles frames split across chunks", async () => {
    const frames = await collect(streamOf(['data: {"sp', 'lit":true}\n', "\n"]));
    expect(frames).toEqual(['{"split":true}']);
  });

  it("ignores id lines, comments and empty frames", async () => {
    const frames = await collect(
      streamOf([": keep-alive\n\n", 'id: 7\ndata: {"kept":true}\n\n', "\n\n"]),
    );
    expect(frames).toEqual(['{"kept":true}']);
  });

  it("drops a trailing frame that never terminated", async () => {
    const frames = await collect(streamOf(['data: {"partial":true}']));
    expect(frames).toEqual([]);
  });
});

describe("sessionIdOf", () => {
  it("reads the id from the harness data envelope", () => {
    expect(sessionIdOf({ data: { id: "session-1" } })).toBe("session-1");
  });

  it("falls back to a bare id and rejects anything else", () => {
    expect(sessionIdOf({ id: "session-2" })).toBe("session-2");
    expect(sessionIdOf({ data: {} })).toBeUndefined();
    expect(sessionIdOf({ id: "" })).toBeUndefined();
    expect(sessionIdOf(null)).toBeUndefined();
  });
});

describe("HarnessClient.createSession", () => {
  const spec = buildAgentSpec({
    model: "google-gemini/gemini-3-5-flash",
    observabilityServer: "vigil-observability",
    deploysServer: "vigil-deploys",
  });

  it("returns the enveloped session id", async () => {
    const client = new HarnessClient("http://harness.test/", async () =>
      Response.json({ data: { id: "session-9" } }, { status: 201 }),
    );
    await expect(client.createSession(spec)).resolves.toBe("session-9");
  });

  it("raises the harness error message and status", async () => {
    const client = new HarnessClient("http://harness.test", async () =>
      Response.json({ error: { message: "model provider not configured" } }, { status: 422 }),
    );
    await expect(client.createSession(spec)).rejects.toThrow(/model provider not configured/);
    await expect(client.createSession(spec)).rejects.toBeInstanceOf(HarnessError);
  });
});
