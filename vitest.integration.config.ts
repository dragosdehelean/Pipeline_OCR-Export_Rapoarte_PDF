import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts", "tests/integration/**/*.test.tsx"],
    environment: "node",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["lib/**/*.ts", "app/api/**/*.ts", "components/**/*.tsx"],
      exclude: ["**/*.d.ts", "app/**/page.tsx", "next.config.js", "playwright.config.ts", "e2e/**"],
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80
    }
  }
});
