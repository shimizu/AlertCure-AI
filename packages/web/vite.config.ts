import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const serverPort = process.env.PORT ?? "8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": `http://127.0.0.1:${serverPort}`,
      "/ws": { target: `ws://127.0.0.1:${serverPort}`, ws: true },
    },
  },
});
