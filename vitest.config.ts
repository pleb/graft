import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["features/**/*.spec.ts", "skills/**/*.spec.ts", "scripts/**/*.spec.ts"],
  },
});
