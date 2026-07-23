import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

const vitestOxcConfig = { tsconfig: false } as never;

export default defineConfig({
  root: import.meta.dirname,
  oxc: vitestOxcConfig,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
