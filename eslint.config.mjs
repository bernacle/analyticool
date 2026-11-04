import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextVitals from "eslint-config-next/core-web-vitals";

export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/next-env.d.ts",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      ".claude/**",
      "docs/design/**/prototype/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["apps/demo/**/*.{ts,tsx}"],
    extends: [...nextVitals],
    settings: { next: { rootDir: "apps/demo/" } },
  },
);
