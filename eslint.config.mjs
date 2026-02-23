// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

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
  ]),
  ...storybook.configs["flat/recommended"],
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
