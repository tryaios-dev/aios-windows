import tseslint from "typescript-eslint";
import { rendererRestrictions } from "../../packages/ts/config/eslint.renderer.js";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // `const { dropped, ...rest } = obj` is the idiomatic way to omit fields.
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: rendererRestrictions,
    ignores: ["src/bridge/**"],
  },
);
