// Flat ESLint config: typescript-eslint (recommended, type-checked off for speed) + @stylistic for
// formatting rules. Applies across all packages/apps in the workspace.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";

export default tseslint.config(
  // vendor/ = interned third-party code (e.g. the webPSX player); public/ = generated/staged artifacts.
  { ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts", "**/coverage/**", "**/vendor/**", "**/public/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  stylistic.configs.customize({
    indent: 2,
    quotes: "double",
    semi: true,
    arrowParens: true,
    braceStyle: "1tbs",
    quoteProps: "as-needed",
  }),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "@stylistic/max-statements-per-line": ["error", { max: 2 }],
      "@stylistic/max-len": ["warn", { code: 120, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreComments: true }],
    },
  },
);
