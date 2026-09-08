/**
 * Reduces a freshly fetched OpenAPI document down to the five schemas and three paths this SDK
 * actually needs (`REQUIRED_SCHEMA_NAMES`/`REQUIRED_PATHS` in gen-types.ts, the single source for
 * both this script and the type generator) and writes the result to `contract/openapi.json`.
 *
 * This is the step `contract/README.md`'s "Renewing the snapshot" recipe runs BETWEEN fetching
 * the live document and formatting/regenerating types — the checked-in file must never be the
 * full document, even transiently, or a `git add` before this step ships the whole private
 * contract (billing, allowlist, admin, ...) into a public repo's permanent history. Reasoning in
 * contract/README.md.
 *
 * Usage: `pnpm --filter @unpii/sdk reduce:contract <path-to-freshly-fetched-raw-document>`
 * The source may also be `contract/openapi.json` itself, to re-reduce a copy that predates this
 * script (self-reducing in place).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { OpenAPI3 } from "openapi-typescript";
import { reduceContractSnapshot } from "./gen-types.js";

const DEST_PATH = fileURLToPath(new URL("../../../contract/openapi.json", import.meta.url));

export async function main(): Promise<void> {
  const sourcePath = process.argv[2];
  if (sourcePath === undefined) {
    throw new Error(
      "reduce-contract-snapshot: pass the path to the freshly fetched raw document, e.g. " +
        "`pnpm --filter @unpii/sdk reduce:contract /tmp/openapi-raw.json`.",
    );
  }
  const doc = JSON.parse(readFileSync(sourcePath, "utf8")) as OpenAPI3;
  const reduced = reduceContractSnapshot(doc);
  // `pnpm format` (biome) is the canonical formatter for this file and runs right after this
  // script in the recipe — this indentation only has to be valid JSON, not byte-perfect.
  writeFileSync(DEST_PATH, `${JSON.stringify(reduced, null, 2)}\n`, "utf8");
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  await main();
}
