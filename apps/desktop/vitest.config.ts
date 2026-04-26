import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@sts2/shared": path.resolve(__dirname, "../../packages/shared"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "src/**/*.test.{ts,tsx}",
      "../../packages/shared/choice-detection/**/*.test.{ts,tsx}",
      "../../packages/shared/evaluation/**/*.test.{ts,tsx}",
      "../../packages/shared/lib/**/*.test.{ts,tsx}",
      "../../packages/shared/tier-sources/**/*.test.{ts,tsx}",
    ],
  },
});
