import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    // artefatos de teste não devem disparar recarga durante o E2E
    watch: { ignored: ["**/test-results/**", "**/playwright-report/**"] },
  },
});
