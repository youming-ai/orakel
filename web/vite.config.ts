import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.API_URL || "http://localhost:9999";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": apiTarget,
      "/ws": {
        target: apiTarget,
        ws: true,
      },
    },
    host: true,
    allowedHosts: true,
    port: 9998,
  },
  build: {
    // Reduce peak memory usage for low-RAM environments (1GB VPS)
    sourcemap: false,
    // Split heavy deps into separate chunks so Rollup doesn't hold everything
    // in memory simultaneously during tree-shaking
    rollupOptions: {
      output: {
        manualChunks: {
          web3: ["viem", "wagmi"],
          charts: ["recharts"],
          ui: ["radix-ui", "lucide-react"],
        },
      },
    },
  },
  // Reduce log verbosity
  logLevel: "warn",
});
