// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";
import tseslint from "typescript-eslint";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Nested project build artifacts
    "codex-release-wrapper/**",
    // Agent worktree build artifacts
    ".claude/worktrees/**",
    ".worktrees/**",
    ".knots/_worktree/**",
  ]),
  ...storybook.configs["flat/recommended"],
  // Code style constraints: file, function, and line length limits.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "max-lines": ["error", {
        max: 500,
        skipBlankLines: true,
        skipComments: true,
      }],
      "max-lines-per-function": ["error", {
        max: 100,
        skipBlankLines: true,
        skipComments: true,
      }],
      "max-len": ["error", {
        code: 100,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreRegExpLiterals: true,
      }],
    },
  },
  // Require explicit handling of promises — prevents fire-and-forget bugs.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/stories/**"],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  // Enforce adapter boundary: only the bd-cli-backend adapter (and its
  // direct tests) may import the low-level @/lib/bd wrapper.  All other
  // code should use getBackend() from @/lib/backend-instance.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: [
      "src/lib/backends/**",
      "src/lib/__tests__/bd*.test.ts",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "@/lib/bd",
          message:
            "Import from @/lib/backend-instance instead. Direct bd imports are only allowed in src/lib/backends/.",
        }],
        patterns: [{
          group: ["**/lib/bd", "**/lib/bd.ts", "./bd", "../bd", "./bd.ts", "../bd.ts"],
          message:
            "Import from @/lib/backend-instance instead. Direct bd imports are only allowed in src/lib/backends/.",
        }],
      }],
    },
  },
]);

export default eslintConfig;
