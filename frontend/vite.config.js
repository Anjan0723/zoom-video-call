// vite.config.js (HTTP VERSION - No SSL)
// Save as: frontend/vite.config.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  server: {
    host: true,  // Listen on all network interfaces
    port: 5173,
    strictPort: true,
    https: {
      key: fs.readFileSync(path.resolve(__dirname, "ssl/key.pem")),
      cert: fs.readFileSync(path.resolve(__dirname, "ssl/cert.pem")),
    },
    proxy: {
      "/socket.io": {
        target: "http://localhost:3001",
        ws: true,
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/upload": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/uploads": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
});