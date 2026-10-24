import tailwindcss from "@tailwindcss/vite";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [tailwindcss()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: environment.VITE_API_PROXY_TARGET || "http://localhost:3000",
          ws: true
        }
      }
    },
    test: {
      environment: "jsdom"
    }
  };
});
