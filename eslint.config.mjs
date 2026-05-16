import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2024
      }
    },
    rules: {
      // Chorus intentionally uses _-prefixed args for ignored params.
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // CLI tool — console output is intentional.
      "no-console": "off",
      "prefer-const": "warn",
      "no-undef": "error",
      // Empty catch blocks with comments are an intentional ignore pattern.
      "no-empty": ["error", { allowEmptyCatch: true }]
    }
  },
  {
    // Tests have their own conventions (vitest globals provided by import).
    files: ["**/*.test.mjs", "core/test/**", "tests/**"],
    rules: {
      "no-unused-vars": "off"
    }
  },
  {
    ignores: [
      "node_modules/",
      ".logs/",
      "leaderboard/",
      "data/",
      "tools/",
      "tests/mocks/stub-*.mjs"
    ]
  }
];
