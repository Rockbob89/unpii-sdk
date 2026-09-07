import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkVersions, readVersions } from "./check-versions.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/**
 * readVersions reads the real repo, so this doubles as a live check that all three files still
 * parse and (today) agree — the thing check-versions.js exists to enforce before a release.
 */
describe("readVersions", () => {
  it("reads packages/sdk, packages/cli and python/pyproject.toml from the real repo", () => {
    const versions = readVersions(REPO_ROOT);
    expect(versions.sdk).toMatch(/^\d+\.\d+\.\d+$/);
    expect(versions.cli).toMatch(/^\d+\.\d+\.\d+$/);
    expect(versions.python).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("checkVersions", () => {
  it("returns no errors when all three versions match and no tag is given", () => {
    expect(checkVersions({ sdk: "1.2.3", cli: "1.2.3", python: "1.2.3" })).toEqual([]);
  });

  it("names all three read values when one of them diverges", () => {
    const errors = checkVersions({ sdk: "1.2.3", cli: "1.9.9", python: "1.2.3" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("packages/sdk/package.json=1.2.3");
    expect(errors[0]).toContain("packages/cli/package.json=1.9.9");
    expect(errors[0]).toContain("python/pyproject.toml=1.2.3");
  });

  it("passes when all three versions also match the release tag", () => {
    expect(checkVersions({ sdk: "2.0.0", cli: "2.0.0", python: "2.0.0" }, "2.0.0")).toEqual([]);
  });

  it("reports a tag mismatch even when the three sources agree with each other", () => {
    const errors = checkVersions({ sdk: "1.0.0", cli: "1.0.0", python: "1.0.0" }, "2.0.0");
    expect(errors).toHaveLength(3);
    expect(errors.join("\n")).toContain("v2.0.0");
    expect(errors.join("\n")).toContain("packages/sdk/package.json=1.0.0");
    expect(errors.join("\n")).toContain("packages/cli/package.json=1.0.0");
    expect(errors.join("\n")).toContain("python/pyproject.toml=1.0.0");
  });
});
