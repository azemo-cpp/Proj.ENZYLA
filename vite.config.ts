import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  assetsInclude: ["**/*.tif"],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: false
      },
      "/nasa-moon": {
        target: "https://trek.nasa.gov/moon",
        changeOrigin: true,
        rewrite: path => path.replace(/^\/nasa-moon/, "")
      }
    }
  }
});
