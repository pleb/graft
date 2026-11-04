import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["skills/**/*.spec.ts", "scripts/**/*.spec.ts"],
  },
});
