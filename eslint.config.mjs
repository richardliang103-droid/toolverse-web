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
    // vinext/wrangler 的本機建置產物（CI 是乾淨 checkout 不會有，但本機 lint 會掃到）。
    "dist/**",
    ".wrangler/**",
    ".vercel/**",
    // Vendored, minified PDF.js worker. It is served as a static asset rather
    // than maintained source code, so linting it produces false positives.
    "public/pdf.worker.min.mjs",
    // AI 助理的 git worktree 會建在 repo 內，裡面是整包原始碼與 node_modules 的
    // 另一份拷貝。不排除的話 `eslint .` 會把每個 worktree 再掃一遍。
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
