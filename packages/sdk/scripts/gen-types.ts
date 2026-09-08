/**
 * Generates `src/types.generated.ts` from the OpenAPI contract snapshot checked in at
 * `contract/openapi.json` — the SDK must not hand-copy the wire contract.
 *
 * Runs `openapiTS()` against a REDUCED copy of the document, never the full one: the contract
 * also carries billing, allowlist, api-keys and admin schemas that have nothing to do with this
 * SDK's public surface — raw `openapiTS()` over the whole document emits ~2000 lines and would
 * leak the entire private API shape into the published `.d.ts`. `reduceDocument()` below keeps
 * only the five request/response schemas this SDK derives types from and empties `paths`, since
 * nothing here needs operation types, only the shapes under `components.schemas`.
 *
 * `Span`, `AnonymizeStats` and `FileWarning` are not schemas of their own in the contract — the
 * server inlines them into the response schemas — so this generator never asks openapiTS to name
 * them directly. Instead a fixed ALIAS_BLOCK below derives all nine public SDK type names from
 * the five generated schemas. See the comment on that block for why it uses index access rather
 * than a hand-copied shape.
 *
 * Run `pnpm --filter @unpii/sdk gen:types` after `contract/openapi.json` changes.
 * `test/gen-types.test.ts` fails until that's done — the drift guard, mirroring the
 * contract-parity check the server side runs in its own CI to keep its Python mirror of this
 * same contract honest.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";
import type { OpenAPI3 } from "openapi-typescript";

const SOURCE_FILE = "contract/openapi.json";
const REGEN_COMMAND = "pnpm --filter @unpii/sdk gen:types";

/**
 * The five schemas this SDK derives its public types from, and the three operations it actually
 * calls. This is the SINGLE list — both `contract/openapi.json` itself (via
 * `reduceContractSnapshot`, run when the snapshot is refreshed, see contract/README.md) and the
 * type generator below (`reduceDocument`) filter through these same two constants. A second,
 * separately-maintained list here would drift from the checked-in file the way it already has
 * elsewhere in the monorepo this SDK was transplanted from (AGENTS.md §8) — one list, two
 * consumers, is the guard against that.
 *
 * The private surface (billing, allowlist, api-keys, admin, auth, ...) is excluded from BOTH the
 * checked-in snapshot and the generated `.d.ts` — not just filtered out of the types while sitting
 * in the tree in full. `https://unpii.me/api/v1/openapi.json` still answers unauthenticated with
 * the complete document; nothing here withholds it from that endpoint. What this avoids is a
 * second, permanent, searchable copy of the private surface in a public repo's git history for no
 * functional reason — see contract/README.md.
 */
export const REQUIRED_SCHEMA_NAMES = [
  "AnonymizeRequest",
  "AnonymizeResponse",
  "AnonymizeFileResponse",
  "AnonymizeFileTextResponse",
  "LimitsResponse",
] as const;

export const REQUIRED_PATHS = [
  "/api/v1/anonymize",
  "/api/v1/anonymize-file",
  "/api/v1/limits",
] as const;

/** Throws — naming the missing schema — rather than silently returning fewer than required: a
 * contract change that renames or drops one of these must fail loudly, not quietly ship a smaller
 * SDK or a snapshot that no longer matches what gen-types.ts assumes. Shared by both
 * `reduceDocument` (type generation) and `reduceContractSnapshot` (the checked-in file) so the
 * "missing schema" case is caught the same way in both places. */
function collectRequiredSchemas(
  doc: OpenAPI3,
): NonNullable<NonNullable<OpenAPI3["components"]>["schemas"]> {
  const sourceSchemas = doc.components?.schemas ?? {};
  const schemas: Record<string, (typeof sourceSchemas)[string]> = {};
  for (const name of REQUIRED_SCHEMA_NAMES) {
    const schema = sourceSchemas[name];
    if (schema === undefined) {
      throw new Error(
        `gen-types: schema "${name}" is missing from ${SOURCE_FILE} — the contract changed shape. Never generate fewer than the schemas this SDK depends on; update REQUIRED_SCHEMA_NAMES and the ALIAS_BLOCK in gen-types.ts deliberately instead.`,
      );
    }
    schemas[name] = schema;
  }
  return schemas;
}

/** Same throw-don't-drop discipline as `collectRequiredSchemas`, for the three paths this SDK
 * actually calls. */
function collectRequiredPaths(doc: OpenAPI3): NonNullable<OpenAPI3["paths"]> {
  const sourcePaths = doc.paths ?? {};
  const paths: Record<string, (typeof sourcePaths)[string]> = {};
  for (const path of REQUIRED_PATHS) {
    const item = sourcePaths[path];
    if (item === undefined) {
      throw new Error(
        `gen-types: path "${path}" is missing from ${SOURCE_FILE} — the contract changed shape. Update REQUIRED_PATHS in gen-types.ts deliberately instead of generating a snapshot without it.`,
      );
    }
    paths[path] = item;
  }
  return paths;
}

/**
 * Builds an in-memory OpenAPI document carrying only the required schemas, with `paths` emptied
 * out — used for TYPE GENERATION only, never for the checked-in snapshot. Operation types are not
 * something this SDK's generated `.d.ts` needs, only the request/response shapes under
 * `components.schemas`, so `openapiTS()` is never even given the three paths `REQUIRED_PATHS`
 * names — see `reduceContractSnapshot` below for where those go instead.
 */
function reduceDocument(doc: OpenAPI3): OpenAPI3 {
  return {
    openapi: doc.openapi,
    info: doc.info,
    paths: {},
    components: { schemas: collectRequiredSchemas(doc) },
  };
}

/**
 * Builds the document that gets WRITTEN to `contract/openapi.json` — the checked-in snapshot —
 * from a freshly fetched full document. Unlike `reduceDocument` above, this keeps the three paths
 * this SDK actually calls (`REQUIRED_PATHS`), so the checked-in file reads as a coherent, honest
 * partial contract (which operations exist, not just orphan schemas) rather than a bag of shapes
 * with no paths. Run via `pnpm --filter @unpii/sdk reduce:contract`, see contract/README.md.
 */
export function reduceContractSnapshot(doc: OpenAPI3): OpenAPI3 {
  return {
    openapi: doc.openapi,
    info: doc.info,
    servers: doc.servers,
    paths: collectRequiredPaths(doc),
    components: { schemas: collectRequiredSchemas(doc) },
  };
}

const BANNER = [
  "// GENERATED FILE — DO NOT EDIT BY HAND.",
  `// Produced by packages/sdk/scripts/gen-types.ts from ${SOURCE_FILE}.`,
  `// Run \`${REGEN_COMMAND}\` to regenerate after a contract change.`,
].join("\n");

/**
 * The nine public SDK type names, aliased from the five generated `components["schemas"]`
 * entries by INDEX ACCESS rather than copied out by hand. This is deliberate: if `markerFormat`
 * disappeared from the contract, or `spans` stopped being an array, a hand-copied alias would
 * keep compiling and silently lie about the contract. An index access into a shape that no
 * longer has that field or that array fails the TYPECHECK instead — the only place a
 * generated-but-stale file can actually be caught.
 *
 * `NonNullable<>` on `MarkerFormat`/`AmbiguousMode` strips the `| undefined` that an optional
 * (`markerFormat?:`) or default-carrying (`ambiguous:`, rendered non-optional by openapiTS'
 * own `defaultNonNullable` default) request field renders with — these two SDK type names
 * describe the VALUE a caller may pass, not the field's optionality on the request body.
 *
 * `LimitsResponse` used to be hand-typed in `src/types.ts` with two groups
 * (`anonymize`/`auth`) marked `@deprecated` in a doc comment. That JSDoc annotation is gone now
 * that the type is derived — deliberately, not lost by accident (contract/README.md has the
 * full reasoning); the two groups themselves are still present, the server still sends them.
 */
const ALIAS_BLOCK = `
export type MarkerFormat = NonNullable<components["schemas"]["AnonymizeRequest"]["markerFormat"]>;
export type AmbiguousMode = NonNullable<components["schemas"]["AnonymizeRequest"]["ambiguous"]>;
export type AnonymizeResponse = components["schemas"]["AnonymizeResponse"];
export type Span = AnonymizeResponse["spans"][number];
export type AnonymizeStats = AnonymizeResponse["stats"];
export type AnonymizeFileResponse = components["schemas"]["AnonymizeFileResponse"];
export type AnonymizeFileTextResponse = components["schemas"]["AnonymizeFileTextResponse"];
export type FileWarning = AnonymizeFileResponse["warnings"][number];
export type LimitsResponse = components["schemas"]["LimitsResponse"];
`;

/** Pure: takes the parsed contract document, returns the file contents as a string. No I/O —
 * this is what the drift-guard test (`test/gen-types.test.ts`) calls directly. */
export async function renderTypes(doc: OpenAPI3): Promise<string> {
  const reduced = reduceDocument(doc);
  const ast = await openapiTS(reduced);
  const generated = astToString(ast);
  return `${BANNER}\n\n${generated}${ALIAS_BLOCK}`;
}

export async function main(): Promise<void> {
  const contractPath = fileURLToPath(new URL("../../../contract/openapi.json", import.meta.url));
  const outPath = fileURLToPath(new URL("../src/types.generated.ts", import.meta.url));
  const doc = JSON.parse(readFileSync(contractPath, "utf8")) as OpenAPI3;
  const content = await renderTypes(doc);
  writeFileSync(outPath, content, "utf8");
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  await main();
}
