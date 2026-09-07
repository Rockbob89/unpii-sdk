#!/usr/bin/env node
// Plain JS, deliberately not TS: this script runs standalone in a CI step
// (`node scripts/check-versions.js`) before anything is built, so it must not depend on a build
// step or on Node's TS type-stripping support (whose flag requirement varies across Node 22.x
// patch releases). It stays a real, testable module rather than a YAML one-liner — JS charter,
// "Scripts stay one-per-action" — via check-versions.test.ts next to it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reads the three version declarations that a release must agree on:
 * packages/sdk/package.json, packages/cli/package.json and python/pyproject.toml.
 */
export function readVersions(repoRoot) {
  const sdk = JSON.parse(readFileSync(join(repoRoot, "packages/sdk/package.json"), "utf8")).version;
  const cli = JSON.parse(readFileSync(join(repoRoot, "packages/cli/package.json"), "utf8")).version;
  const pyproject = readFileSync(join(repoRoot, "python/pyproject.toml"), "utf8");
  const match = pyproject.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error('python/pyproject.toml: no version = "..." line found under [project]');
  }
  return { sdk, cli, python: match[1] };
}

/**
 * Compares the three versions against each other, and — when `tagVersion` is given (the release
 * tag with its leading "v" stripped) — against the tag too. Returns a list of error messages;
 * an empty list means everything agrees. Never throws: the caller decides what to do with the
 * errors. Every message names all three read values, not just the odd one out — the point is
 * that whoever reads the failure doesn't have to go look the values up themselves.
 */
export function checkVersions(versions, tagVersion) {
  const errors = [];
  const { sdk, cli, python } = versions;

  if (!(sdk === cli && cli === python)) {
    errors.push(
      `Versionen weichen voneinander ab: packages/sdk/package.json=${sdk}, ` +
        `packages/cli/package.json=${cli}, python/pyproject.toml=${python}`,
    );
  }

  if (tagVersion !== undefined) {
    const sources = [
      ["packages/sdk/package.json", sdk],
      ["packages/cli/package.json", cli],
      ["python/pyproject.toml", python],
    ];
    for (const [name, value] of sources) {
      if (value !== tagVersion) {
        errors.push(`Tag v${tagVersion} passt nicht zu ${name}=${value}`);
      }
    }
  }

  return errors;
}

function tagVersionFromRef(ref) {
  if (!ref) return undefined;
  const match = /^refs\/tags\/v(.+)$/.exec(ref);
  return match ? match[1] : undefined;
}

function main() {
  const repoRoot = process.argv[2] ?? process.cwd();
  const tagVersion = tagVersionFromRef(process.env.GITHUB_REF);
  const versions = readVersions(repoRoot);
  const errors = checkVersions(versions, tagVersion);

  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }

  console.log(
    `Versionen stimmen ueberein: ${versions.sdk}${tagVersion ? ` (Tag v${tagVersion})` : ""}`,
  );
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main();
}
