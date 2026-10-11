import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:3000",
        changeOrigin: false,
      },
      "/socket.io": {
        target: process.env.VITE_API_TARGET ?? "http://localhost:3000",
        changeOrigin: false,
        ws: true,
      },
    },
  },
});
