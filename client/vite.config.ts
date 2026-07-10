import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("../shared/src", import.meta.url)),
    },
  },
  server: {
    fs: { allow: [".."] },
  },
  build: { target: "es2022" },
  worker: { format: "es" },
});
