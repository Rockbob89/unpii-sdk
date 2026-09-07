import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { OpenAPI3 } from "openapi-typescript";
import { describe, it } from "vitest";

/**
 * Compares the checked-in `contract/openapi.json` against the LIVE production document. Skipped
 * by default — this hits the real network and the real server — and runs only when
 * `UNPII_CONTRACT_LIVE=1` is set, per `contract/README.md`'s "renewing the snapshot" recipe.
 */
const LIVE_URL = "https://unpii.me/api/v1/openapi.json";
const CONTRACT_PATH = fileURLToPath(new URL("../../../contract/openapi.json", import.meta.url));
const RUN_LIVE = process.env.UNPII_CONTRACT_LIVE === "1";

const DERIVED_SCHEMA_NAMES = [
  "AnonymizeRequest",
  "AnonymizeResponse",
  "AnonymizeFileResponse",
  "AnonymizeFileTextResponse",
  "LimitsResponse",
] as const;

function readSnapshot(): OpenAPI3 {
  return JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as OpenAPI3;
}

/** A network failure here (DNS, connection refused, non-2xx) must fail the test, never resolve
 * to a silent pass — this function never catches, so any throw/rejection propagates straight
 * into the test. */
async function fetchLive(): Promise<OpenAPI3> {
  const res = await fetch(LIVE_URL);
  if (!res.ok) {
    throw new Error(
      `live contract fetch failed: HTTP ${res.status} from ${LIVE_URL} — a bad response must fail this test, not be treated as "nothing to compare".`,
    );
  }
  return (await res.json()) as OpenAPI3;
}

function omit(obj: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!keys.includes(key)) result[key] = value;
  }
  return result;
}

/**
 * `info.version` and `servers` are stripped before the whole-document comparison:
 * `info.version` is the running server's `APP_VERSION`, which moves on every deploy and says
 * nothing about the wire CONTRACT; `servers` still carries the `https://anonymize.example`
 * placeholder (see contract/README.md) and was never meant to be read. Neither belongs in a
 * check for contract drift.
 */
function normalizeForWholeDocumentComparison(doc: OpenAPI3): Record<string, unknown> {
  const { info, ...rest } = doc as unknown as Record<string, unknown>;
  return {
    ...omit(rest, ["servers"]),
    info: omit(info as Record<string, unknown>, ["version"]),
  };
}

/**
 * Deep equality that reports WHERE two values first differ and what each side held there,
 * instead of vitest's generic "not equal" — unreadable on a ~2800-line document without knowing
 * the path. Depth-first, returns the first difference found or `undefined` when equal.
 *
 * The reported values are embedded verbatim in the returned string, which would normally be a
 * reason to keep this kind of diff out of logs/errors (Charter: never let caller input reach a
 * message or stack). That risk doesn't apply here: both sides are an OpenAPI document — API
 * shape metadata, never a request body or user-submitted text — so there is nothing to leak.
 */
function firstDifference(a: unknown, b: unknown, path: string): string | undefined {
  if (a === b) return undefined;
  const bothObjects = typeof a === "object" && typeof b === "object" && a !== null && b !== null;
  if (!bothObjects) {
    return `${path || "(root)"}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return `${path || "(root)"}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj).sort();
  const bKeys = Object.keys(bObj).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((key, i) => key !== bKeys[i])) {
    return `${path || "(root)"}: keys ${JSON.stringify(aKeys)} !== ${JSON.stringify(bKeys)}`;
  }
  for (const key of aKeys) {
    const childPath = path ? `${path}.${key}` : key;
    const diff = firstDifference(aObj[key], bObj[key], childPath);
    if (diff !== undefined) return diff;
  }
  return undefined;
}

describe.skipIf(!RUN_LIVE)("live contract (UNPII_CONTRACT_LIVE=1)", () => {
  it("the five schemas the SDK derives its types from are unchanged in production", async () => {
    // This is the check that counts: if any of these five schemas has drifted, the SDK's types
    // no longer describe what the server actually sends or accepts.
    const snapshot = readSnapshot();
    const live = await fetchLive();
    for (const name of DERIVED_SCHEMA_NAMES) {
      const diff = firstDifference(
        snapshot.components?.schemas?.[name],
        live.components?.schemas?.[name],
        `components.schemas.${name}`,
      );
      if (diff !== undefined) {
        throw new Error(
          `live contract schema "${name}" deviates from contract/openapi.json — ${diff}`,
        );
      }
    }
  });

  it("the rest of the document (excluding info.version and servers) is unchanged in production", async () => {
    // This is the check that reports staleness: it catches everything the previous test does
    // not — an added route, a changed schema outside the SDK's five — so it is expected to go
    // red long before the SDK's own types are actually wrong. A red result here means "refresh
    // the snapshot" (contract/README.md), not necessarily "the SDK is broken".
    const snapshot = readSnapshot();
    const live = await fetchLive();
    const diff = firstDifference(
      normalizeForWholeDocumentComparison(snapshot),
      normalizeForWholeDocumentComparison(live),
      "",
    );
    if (diff !== undefined) {
      throw new Error(
        `contract/openapi.json is stale — live document deviates (excluding info.version and servers): ${diff}`,
      );
    }
  });
});
