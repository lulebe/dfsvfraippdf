import { defineConfig } from "vitest/config";

const apiPort = process.env.API_PORT ?? "8787";

export default defineConfig({
  server: {
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
  preview: {
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
  test: {
    environment: "node",
  },
});