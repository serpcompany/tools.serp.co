import { nextJsConfig } from "@serp-tools/eslint-config/next-js";

const turboEnvAllowList = [
  "^YTDLP_BINARY_URL$",
  "^YOUTUBE_DL_HOST$",
  "^GITHUB_TOKEN$",
  "^GH_TOKEN$",
  "^ADSENSE_PUBLISHER_ID$",
  "^CLOUDFLARE_BASE_URL$",
  "^FEATURE_FLAG_DOWNLOADER_EXTENSION_ONLY$",
  "^MEDIA_FETCH_SMOKE_URL$",
  "^NEXT_PUBLIC_ASSETS_BASE_URL$",
  "^NEXT_PUBLIC_DOWNLOADER_MEDIA_FETCH_ENDPOINT$",
  "^NEXT_PUBLIC_MEDIA_FETCH_ENDPOINT$",
  "^R2_ASSETS_BUCKET$",
  "^SERVER_ACTION_RATE_LIMIT_SECRET$",
  "^PORT$",
];

/** @type {import("eslint").Linter.Config} */
export default [
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "out/**",
      "public/vendor/**",
      "node_modules/**",
      "benchmarks/fixtures/**",
    ],
  },
  ...nextJsConfig,
  {
    files: ["scripts/**/*.{js,mjs,cjs}", "next.config.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
      },
    },
  },
  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["next-env.d.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
  {
    files: ["workers/**/*.{js,mjs,cjs}"],
    rules: {
      "@next/next/no-assign-module-variable": "off",
    },
  },
  {
    rules: {
      "turbo/no-undeclared-env-vars": ["warn", { allowList: turboEnvAllowList }],
    },
  },
];
