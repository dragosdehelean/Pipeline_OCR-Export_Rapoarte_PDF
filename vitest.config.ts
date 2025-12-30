import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/node/**/*.test.ts", "tests/node/**/*.test.tsx"],
    environment: "jsdom",
    globals: true,
    environmentMatchGlobs: [["tests/node/integration/**", "node"]],
    setupFiles: ["tests/node/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "tests/node/coverage",
      include: ["app/_lib/**/*.ts", "app/api/**/*.ts", "app/_components/**/*.tsx"],
      exclude: [
        "**/*.d.ts",
        "app/**/page.tsx",
        "next.config.js",
        "playwright.config.ts",
        "tests/node/e2e/**"
      ],
      lines: 80,
      functions: 80,
      branches: 75,
      statements: 80
    }
  }
});
