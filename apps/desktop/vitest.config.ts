import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@sts2/shared": path.resolve(__dirname, "../../packages/shared"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
