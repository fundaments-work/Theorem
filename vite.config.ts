import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "url";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Optimize dependencies for faster dev server startup
  optimizeDeps: {
    exclude: [
      // Foliate-js handles its own imports
      'src/foliate-js/mobi.js',
      'src/foliate-js/fb2.js',
      'src/foliate-js/comic-book.js',
      'src/foliate-js/view.js',
    ],
    include: [
      // Include pdfjs-dist for pre-bundling
      'pdfjs-dist',
    ],
  },

  // Build configuration
  build: {
    assetsInlineLimit: 0,
  },

  // Server configuration
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    // Allow serving files from node_modules for pdfjs-dist
    fs: {
      allow: ['..', './node_modules/pdfjs-dist'],
    },
  },

  // Prevent Vite from obscuring rust errors
  clearScreen: false,
}));
