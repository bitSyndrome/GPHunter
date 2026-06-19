import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 5173 (vite default) collides with other local services — use 5273.
    port: Number(process.env.WEB_PORT ?? 5273),
    strictPort: true,
    proxy: {
      "/api": `http://localhost:${process.env.PORT ?? 8787}`,
    },
  },
});
