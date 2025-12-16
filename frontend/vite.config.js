// vite.config.js (HTTP VERSION - No SSL)
// Save as: frontend/vite.config.js

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  server: {
    host: true,  // Listen on all network interfaces
    port: 5173,
    strictPort: true,
  },
  plugins: [react()],
});