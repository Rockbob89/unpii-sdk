import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Builds @unpii/sdk, then this package, before any test runs — so dist/cli.js exists and
    // resolves the SDK through node_modules exactly as a published consumer would. See
    // test/build-setup.ts.
    globalSetup: ["./test/build-setup.ts"],
    hookTimeout: 120_000,
    testTimeout: 20_000,
  },
});
