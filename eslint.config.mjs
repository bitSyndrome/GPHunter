// Flat ESLint config. Kept deliberately lean: correctness-oriented rules only,
// no stylistic ones (Prettier owns formatting — see .prettierrc.json).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    // Build output, deps and runtime artifacts are never linted.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "web/dist/**",
      "scripts/dist/**",
      "coverage/**",
      ".run/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Server, CLI and shared all run on Node.
  {
    files: ["server/**/*.ts", "cli/**/*.ts", "shared/**/*.ts"],
    languageOptions: { globals: globals.node },
  },

  // The dashboard runs in the browser.
  {
    files: ["web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },

  // Dev-only scripts (screenshots, smoke shots) are plain Node ESM.
  {
    files: ["**/*.mjs", "*.js"],
    languageOptions: { globals: globals.node },
  },

  // app.ts embeds the install.sh / install.ps1 scripts in template literals,
  // where every `$` is escaped deliberately and uniformly so the emitted shell
  // reads correctly and `\${` stays safe. "Fixing" these escapes would edit the
  // generated installers — the one path every new device goes through — so the
  // rule is switched off here rather than the code bent to satisfy it.
  {
    files: ["server/src/app.ts"],
    rules: { "no-useless-escape": "off" },
  },

  {
    rules: {
      // The agents swallow errors on purpose — never block Claude. An empty
      // catch is the intended control flow there, so allow it explicitly.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Allow deliberately unused args/vars when prefixed with _ (destructured
      // regex captures in the key-normalization helpers rely on this).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
);
