import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        statements: 70,
        branches: 65,
        functions: 70,
        lines: 75,
      },
    },
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    passWithNoTests: false,
    clearMocks: true,
  },
})
