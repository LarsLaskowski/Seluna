// ESLint flat config seeded by the Squad-Spec-Repository-Template `typescript` profile.
// typescript-eslint's type-aware rules (strictTypeChecked, through the project service) and
// eslint-plugin-sonarjs run locally, so the analyzer gate finds what SonarQube Cloud would report.
import js from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**", ".wrangler/**", "**/*.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  sonarjs.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The rules return channel-neutral notifications: no messenger code may be reached from them (AC12).
    files: ["src/rules/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/message",
                "**/message.js",
                "**/telegram",
                "**/telegram.js",
                "**/delivery",
                "**/delivery.js",
                "**/notification",
                "**/notification.js",
                "**/channels",
                "**/channels/*",
                "**/bot-token",
                "**/bot-token.js",
              ],
              message: "src/rules/ returns channel-neutral notifications and may not import messenger code.",
            },
          ],
        },
      ],
    },
  },
  {
    // `D1Database` still declares the deprecated `dump()`, so a test double implementing the interface has to name it
    // (typescript-eslint 8.72 reports deprecated members in object literals, and its `allow` option does not cover
    // them); production code stays checked.
    files: ["src/**/*.test.ts", "test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
  {
    // Configuration files are plain JavaScript outside the TypeScript project.
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    ...tseslint.configs.disableTypeChecked,
  },
);
