import { defineConfig } from "vitest/config";

export default defineConfig({
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
