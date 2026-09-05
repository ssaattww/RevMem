import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"]
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["src/t405-review-contexts-runtime.ts"],
    rules: {
      "no-useless-assignment": "off"
    }
  }
);
