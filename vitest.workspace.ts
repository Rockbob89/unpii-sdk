import { defineWorkspace } from "vitest/config";

/**
 * Lets a single `vitest run` at the root fan out to every package's own vitest.config.ts (its
 * globalSetup, its build-before-test) plus the root-level scripts/ tests, instead of chaining
 * `pnpm -r test && vitest run scripts` in package.json's "test" script. See scripts/
 * check-versions.test.ts for what the "scripts" project covers.
 */
export default defineWorkspace([
  "packages/*",
  {
    test: {
      name: "scripts",
      root: "./scripts",
      include: ["**/*.test.ts"],
      environment: "node",
    },
  },
]);
