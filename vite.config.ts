import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  server: {
    proxy: {
      "/chat_stream": "http://localhost:5000",
      "/upload_doc": "http://localhost:5000",
      "/memories": "http://localhost:5000",
      "/load_sheet": "http://localhost:5000",
      "/screen_snapshot": "http://localhost:5000",
      "/test_db": "http://localhost:5000",
    },
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"), // 🔥 THIS LINE FIXES IT
    },
  },
});