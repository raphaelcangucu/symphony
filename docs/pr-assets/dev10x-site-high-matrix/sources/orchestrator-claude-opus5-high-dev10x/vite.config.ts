import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Playwright writes artifacts under the project root while tests run.
    // Watching them would trigger HMR reloads in the middle of a test.
    watch: {
      ignored: ["**/test-results/**", "**/playwright-report/**", "**/.symphony/**"],
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
