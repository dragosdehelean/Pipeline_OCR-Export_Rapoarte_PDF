/**
 * @fileoverview Flat ESLint config that mirrors the Next.js core-web-vitals preset.
 */
import config from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...config,
  {
    ignores: [
      ".next-e2e/**",
      "tests/node/coverage/**",
      "tests/node/e2e/test-results/**",
      "services/docling_worker/.venv/**"
    ]
  }
];

export default eslintConfig;
