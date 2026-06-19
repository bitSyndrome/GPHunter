import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Bind all interfaces so other PCs on the LAN can open the dashboard.
    host: true, // 0.0.0.0
    // 5173 (vite default) collides with other local services — use 5273.
    port: Number(process.env.WEB_PORT ?? 5273),
    strictPort: true,
    // Allow access via any hostname/IP (DNS-rebind guard off for LAN use).
    allowedHosts: true,
    proxy: {
      "/api": `http://localhost:${process.env.PORT ?? 8787}`,
    },
  },
});
