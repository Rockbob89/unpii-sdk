import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { OpenAPI3 } from "openapi-typescript";
import { describe, expect, it } from "vitest";
import { renderTypes } from "../scripts/gen-types.js";

const CONTRACT_PATH = fileURLToPath(new URL("../../../contract/openapi.json", import.meta.url));
const GENERATED_PATH = fileURLToPath(new URL("../src/types.generated.ts", import.meta.url));

function readContract(): OpenAPI3 {
  return JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as OpenAPI3;
}

describe("renderTypes()", () => {
  it("matches the checked-in src/types.generated.ts byte for byte", async () => {
    // This is the drift guard: a change to contract/openapi.json that isn't followed by
    // `pnpm --filter @unpii/sdk gen:types` turns this red. Mirrors
    // apps/inference/tests/test_contract_parity.py in the main unpii monorepo.
    const checkedIn = readFileSync(GENERATED_PATH, "utf8");
    const rendered = await renderTypes(readContract());
    expect(rendered).toBe(checkedIn);
  });

  it("would actually catch drift — the guard is not a tautology", async () => {
    const rendered = await renderTypes(readContract());
    // A field the generator is known to emit today.
    expect(rendered).toContain("category: string");
    // Tampering with that field, the way an unregenerated file would if the contract changed
    // `category` to a number, must be detectable as a mismatch against the live generator.
    const tampered = rendered.replace("category: string", "category: number");
    expect(tampered).not.toBe(rendered);
    expect(tampered).not.toBe(readFileSync(GENERATED_PATH, "utf8"));
  });

  it("never emits `any`", async () => {
    const rendered = await renderTypes(readContract());
    expect(rendered).not.toMatch(/\bany\b/);
  });
});
