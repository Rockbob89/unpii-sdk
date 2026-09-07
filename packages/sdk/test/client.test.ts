import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Unpii } from "../src/client.js";
import { UnpiiError } from "../src/errors.js";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url)), "utf8");
}

interface RecordedCall {
  url: string;
  init: RequestInit;
}

/** Records every call and returns canned Responses in the order given (or, when only one is
 * given, that same Response's clone for every call). Real `Response`/`Headers`/`FormData` —
 * Node 22 has all three globally — so header/body handling matches production exactly. */
function fakeFetch(responses: Response[]): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let i = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const template = responses[Math.min(i, responses.length - 1)];
    i++;
    if (!template) throw new Error("fakeFetch: no response configured");
    return template.clone();
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function jsonResponse(body: string, status = 200, headers?: Record<string, string>): Response {
  return new Response(body, { status, headers });
}

describe("Unpii client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("constructor", () => {
    it("throws UnpiiError for an empty apiKey", () => {
      expect(() => new Unpii({ apiKey: "" })).toThrow(UnpiiError);
      try {
        new Unpii({ apiKey: "" });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(UnpiiError);
        expect((err as UnpiiError).code).toBe("missing_api_key");
      }
    });

    it("throws UnpiiError for a whitespace-only apiKey", () => {
      expect(() => new Unpii({ apiKey: "   " })).toThrow(UnpiiError);
    });
  });

  describe("anonymize()", () => {
    it("POSTs to /api/v1/anonymize with Authorization, JSON body, and omitted-undefined fields", async () => {
      const { fetch: fx, calls } = fakeFetch([jsonResponse(fixture("anonymize.docs.json"))]);
      const client = new Unpii({ apiKey: "docs-key", fetch: fx });

      await client.anonymize("Hallo Anne Schmitz", { markerFormat: "default" });

      expect(calls).toHaveLength(1);
      const call = calls[0];
      if (!call) throw new Error("expected a recorded call");
      expect(call.url).toBe("https://api.unpii.me/api/v1/anonymize");
      expect(call.init.method).toBe("POST");
      const headers = call.init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer docs-key");
      expect(headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(call.init.body as string);
      expect(body).toEqual({ text: "Hallo Anne Schmitz", markerFormat: "default" });
      // ambiguous / keep / structure were never passed in opts and must not appear at all.
      expect(Object.keys(body).sort()).toEqual(["markerFormat", "text"]);
    });

    it("returns fixtures/anonymize.docs.json unchanged", async () => {
      const raw = fixture("anonymize.docs.json");
      const { fetch: fx } = fakeFetch([jsonResponse(raw)]);
      const client = new Unpii({ apiKey: "docs-key", fetch: fx });

      const result = await client.anonymize("Hallo Team, Anne Schmitz ...");

      expect(result).toEqual(JSON.parse(raw));
    });

    it("returns fixtures/anonymize.anon.json (masked xxxxx / REDACTED) unchanged", async () => {
      const raw = fixture("anonymize.anon.json");
      const { fetch: fx } = fakeFetch([jsonResponse(raw)]);
      const client = new Unpii({ apiKey: "anon-key", fetch: fx });

      const result = await client.anonymize("Hallo Team, Anne Schmitz ...");

      expect(result).toEqual(JSON.parse(raw));
    });

    it("reads no environment variables — UNPII_BASE_URL has zero effect on the request URL", async () => {
      vi.stubEnv("UNPII_BASE_URL", "https://evil.example");
      const { fetch: fx, calls } = fakeFetch([jsonResponse(fixture("anonymize.docs.json"))]);
      const client = new Unpii({ apiKey: "docs-key", fetch: fx });
      await client.anonymize("hello");
      const call = calls[0];
      if (!call) throw new Error("expected a recorded call");
      expect(call.url).toBe("https://api.unpii.me/api/v1/anonymize");
    });

    it("strips trailing slashes from an explicit baseUrl", async () => {
      const { fetch: fx, calls } = fakeFetch([jsonResponse(fixture("anonymize.docs.json"))]);
      const client = new Unpii({ apiKey: "k", baseUrl: "http://localhost:3001/", fetch: fx });
      await client.anonymize("hello");
      expect(calls[0]?.url).toBe("http://localhost:3001/api/v1/anonymize");
    });
  });

  describe("error handling", () => {
    it("throws UnpiiError(402, 'tier_required') for fixtures/error.tier-required.json", async () => {
      const { fetch: fx } = fakeFetch([jsonResponse(fixture("error.tier-required.json"), 402)]);
      const client = new Unpii({ apiKey: "anon-key", fetch: fx });

      await expect(client.anonymize("some input")).rejects.toMatchObject({
        status: 402,
        code: "tier_required",
      });
    });

    it("never puts the response body or the caller's input into message or stack", async () => {
      const secretInput = "SECRET_MARKER_INPUT_9f3ac21";
      const { fetch: fx } = fakeFetch([jsonResponse(fixture("error.tier-required.json"), 402)]);
      const client = new Unpii({ apiKey: "anon-key", fetch: fx });

      let caught: UnpiiError | undefined;
      try {
        await client.anonymize(secretInput);
      } catch (err) {
        caught = err as UnpiiError;
      }
      expect(caught).toBeInstanceOf(UnpiiError);
      const message = caught?.message ?? "";
      const stack = caught?.stack ?? "";
      // The body's own message text and the "markerFormat"/"tier" fields it carries.
      expect(message).not.toContain("markerFormat not available");
      expect(stack).not.toContain("markerFormat not available");
      // The caller's own input text.
      expect(message).not.toContain(secretInput);
      expect(stack).not.toContain(secretInput);
    });

    it("propagates x-request-id from the response headers", async () => {
      const { fetch: fx } = fakeFetch([
        jsonResponse(fixture("error.account-tier-required.json"), 402, {
          "x-request-id": "req-abc-123",
        }),
      ]);
      const client = new Unpii({ apiKey: "free-key", fetch: fx });

      await expect(client.anonymize("x")).rejects.toMatchObject({
        status: 402,
        code: "account_tier_required",
        requestId: "req-abc-123",
      });
    });

    it("treats a hostile code (script-shaped string) as undefined, not as .code", async () => {
      const body = JSON.stringify({ error: { code: "<script>alert(1)</script>", message: "x" } });
      const { fetch: fx } = fakeFetch([jsonResponse(body, 500)]);
      const client = new Unpii({ apiKey: "k", fetch: fx });

      await expect(client.anonymize("x")).rejects.toMatchObject({ status: 500, code: undefined });
    });

    it("treats an oversized code (500 chars) as undefined, not as .code", async () => {
      const body = JSON.stringify({ error: { code: "a".repeat(500), message: "x" } });
      const { fetch: fx } = fakeFetch([jsonResponse(body, 500)]);
      const client = new Unpii({ apiKey: "k", fetch: fx });

      await expect(client.anonymize("x")).rejects.toMatchObject({ status: 500, code: undefined });
    });

    it("scan() against Fastify's own 404 envelope (error is a STRING, not an object) yields code undefined, not a crash", async () => {
      const raw = fixture("error.route-not-found.json");
      const { fetch: fx } = fakeFetch([jsonResponse(raw, 404)]);
      const client = new Unpii({ apiKey: "docs-key", fetch: fx });

      let caught: UnpiiError | undefined;
      try {
        await client.scan("some input");
      } catch (err) {
        caught = err as UnpiiError;
      }
      expect(caught).toBeInstanceOf(UnpiiError);
      expect(caught?.status).toBe(404);
      expect(caught?.code).toBeUndefined();
      const message = caught?.message ?? "";
      const stack = caught?.stack ?? "";
      expect(message).not.toContain("Route POST:/api/v1/scan not found");
      expect(stack).not.toContain("Route POST:/api/v1/scan not found");
      expect(message).not.toContain("Not Found");
    });

    it("an empty, non-JSON response body yields code undefined rather than throwing a different error", async () => {
      const { fetch: fx } = fakeFetch([jsonResponse("", 502)]);
      const client = new Unpii({ apiKey: "k", fetch: fx });

      let caught: UnpiiError | undefined;
      try {
        await client.anonymize("x");
      } catch (err) {
        caught = err as UnpiiError;
      }
      expect(caught).toBeInstanceOf(UnpiiError);
      expect(caught?.status).toBe(502);
      expect(caught?.code).toBeUndefined();
    });
  });

  describe("anonymizeFile()", () => {
    it("appends markerFormat, redactUncertain, outputFormat BEFORE file, and never sets Content-Type", async () => {
      const { fetch: fx, calls } = fakeFetch([jsonResponse(fixture("anonymize-file.docx.json"))]);
      const client = new Unpii({ apiKey: "docs-key", fetch: fx });

      await client.anonymizeFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
        filename: "sample.docx",
        markerFormat: "default",
        redactUncertain: true,
        outputFormat: "docx",
      });

      const call = calls[0];
      if (!call) throw new Error("expected a recorded call");
      expect(call.init.method).toBe("POST");
      const headers = call.init.headers as Record<string, string> | undefined;
      expect(headers?.["Content-Type"]).toBeUndefined();

      const form = call.init.body as FormData;
      const order = Array.from(form.keys());
      expect(order).toEqual(["markerFormat", "redactUncertain", "outputFormat", "file"]);
      expect(form.get("markerFormat")).toBe("default");
      expect(form.get("redactUncertain")).toBe("true");
      expect(form.get("outputFormat")).toBe("docx");
      const filePart = form.get("file");
      expect(filePart).toBeInstanceOf(Blob);
    });

    it("omits a field entirely when its option is not given", async () => {
      const { fetch: fx, calls } = fakeFetch([jsonResponse(fixture("anonymize-file.docx.json"))]);
      const client = new Unpii({ apiKey: "docs-key", fetch: fx });

      await client.anonymizeFile(new Uint8Array([0x50, 0x4b]), { filename: "a.docx" });

      const form = calls[0]?.init.body as FormData;
      expect(Array.from(form.keys())).toEqual(["file"]);
    });

    it("returns fixtures/anonymize-file.docx.json unchanged", async () => {
      const raw = fixture("anonymize-file.docx.json");
      const { fetch: fx } = fakeFetch([jsonResponse(raw)]);
      const client = new Unpii({ apiKey: "docs-key", fetch: fx });

      const result = await client.anonymizeFile(new Uint8Array([0x50, 0x4b]), {
        filename: "sample.docx",
      });

      expect(result).toEqual(JSON.parse(raw));
    });
  });

  describe("limits()", () => {
    it("GETs /api/v1/limits", async () => {
      const body = JSON.stringify({
        current: { tier: "docs", channel: "api", daily_limit: 100, entitled: true },
        reference: {
          web: { anon: 1, free: 2, docs: 3, api: 4, pro: 5, ultra: 6 },
          api: { free: 1, docs: 2, api: 3, pro: 4, ultra: 5 },
        },
        burst: { magic_link_per_hour: 5 },
        anonymize: { anonymous_per_day: 1, user_per_day: 2, apikey_per_day: 3 },
        auth: { magic_link_per_hour: 5 },
      });
      const { fetch: fx, calls } = fakeFetch([jsonResponse(body)]);
      const client = new Unpii({ apiKey: "docs-key", fetch: fx });

      const result = await client.limits();

      expect(calls[0]?.init.method).toBe("GET");
      expect(calls[0]?.url).toBe("https://api.unpii.me/api/v1/limits");
      expect(result.current.tier).toBe("docs");
    });
  });
});
