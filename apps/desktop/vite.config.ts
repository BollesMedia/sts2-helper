import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@sts2/shared": path.resolve(__dirname, "../../packages/shared"),
    },
  },
  // Expose VITE_ and TAURI_ prefixed env vars to the frontend
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // Target older WebView2 on Windows, Safari 14+ on macOS
    target:
      process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari14",
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
