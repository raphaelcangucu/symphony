import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/tracker/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../elixir/priv/static/tracker",
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: Number.parseInt(process.env.TRACKER_PORT ?? "5173", 10),
    proxy: {
      "/api": {
        target: process.env.TRACKER_API_PROXY_TARGET ?? "http://127.0.0.1:4000",
        changeOrigin: true,
      },
      "/socket": {
        target: process.env.TRACKER_SOCKET_PROXY_TARGET ?? "ws://127.0.0.1:4000",
        ws: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
