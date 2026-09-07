import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Builds this package before any test runs, so dist/ exists for
    // test/package-shape.test.ts's `npm pack --dry-run` check. See test/build-setup.ts.
    globalSetup: ["./test/build-setup.ts"],
    hookTimeout: 120_000,
    testTimeout: 20_000,
  },
});
