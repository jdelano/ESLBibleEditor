import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    fs: {
      allow: [path.resolve(__dirname, "../..")]
    }
  },
  resolve: {
    alias: {
      "@schema": path.resolve(__dirname, "../../packages/schema/src"),
      "@ui": path.resolve(__dirname, "../../packages/ui/src")
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts"
  }
});
