import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**", "**/coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: { project: false, sourceType: "module" },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      eqeqeq: ["error", "always"],
      "no-implicit-coercion": "error",
      "prefer-const": "error",
    },
  },
  {
    files: ["apps/**/src/**/*.ts", "packages/**/src/**/*.ts"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "app", pattern: "apps/*", mode: "folder" },
        { type: "pkg", pattern: "packages/*", mode: "folder" },
      ],
      "boundaries/include": ["apps/**/*.ts", "packages/**/*.ts"],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "allow",
          rules: [
            {
              from: ["app"],
              disallow: ["app"],
              message: "apps must not import each other; go through packages",
            },
          ],
        },
      ],
      "boundaries/no-unknown": "off",
      "boundaries/no-unknown-files": "off",
    },
  },
  {
    // INV-ARCH-01: the edge is not Next.
    files: ["apps/edge/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*"],
              message: "edge must not import Next (INV-ARCH-01)",
            },
          ],
        },
      ],
    },
  },
  {
    // INV-ARCH-01: the control plane holds no Worker bindings.
    files: ["apps/control/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["cloudflare:*", "@cloudflare/*"],
              message: "control must not import Worker bindings (INV-ARCH-01)",
            },
            {
              group: ["@chameleon/db", "@chameleon/crypto"],
              message: "import these only from a server-only module",
            },
          ],
        },
      ],
    },
  },
  {
    // INV-ARCH-04: only the engine compares service types.
    files: ["apps/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "BinaryExpression > :matches(Identifier[name='serviceType'], MemberExpression[property.name='serviceType'])",
          message: "compare service types inside packages/engine (INV-ARCH-04)",
        },
      ],
    },
  },
  {
    // skeleton stays pure and runtime-neutral (plan/repo-tree.md).
    files: ["packages/skeleton/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "node:*",
                "@chameleon/db",
                "@chameleon/crypto",
                "@chameleon/engine",
              ],
              message: "skeleton is pure: no runtime deps",
            },
          ],
        },
      ],
    },
  },
  {
    // contracts is zod only.
    files: ["packages/contracts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@chameleon/*", "node:*"],
              message: "contracts has no workspace or node deps",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/scripts/**/*.mjs", "scripts/**/*.mjs", "**/*.config.{js,mjs,ts,cjs}"],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off", "@typescript-eslint/no-explicit-any": "off" },
  },
);
