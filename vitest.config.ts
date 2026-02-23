import { defineConfig } from "vitest/config";

export default defineConfig({
  // Alias apcore-js to prevent Vite from resolving the stub package (no dist/).
  // Tests that need apcore-js behavior must use vi.doMock() to provide a mock.
  resolve: {
    alias: {
      "apcore-js": "/dev/null",
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/cli.ts",
        "src/types.ts",
        "src/**/index.ts",
        "src/server/transport.ts",
      ],
      thresholds: {
        lines: 90,
      },
    },
  },
});
