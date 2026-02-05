import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "url";
import { viteStaticCopy } from "vite-plugin-static-copy";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
    plugins: [
        react(),
        tailwindcss(),
        // Copy PDF.js assets (cmaps and fonts) from node_modules to build output
        viteStaticCopy({
            targets: [
                {
                    src: "node_modules/pdfjs-dist/cmaps/*",
                    dest: "pdfjs/cmaps",
                },
                {
                    src: "node_modules/pdfjs-dist/standard_fonts/*",
                    dest: "pdfjs/standard_fonts",
                },
            ],
        }),
    ],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },

    // Optimize dependencies for faster dev server startup
    optimizeDeps: {
        exclude: [
            // Foliate-js handles its own imports
            "src/foliate-js/mobi.js",
            "src/foliate-js/fb2.js",
            "src/foliate-js/comic-book.js",
            "src/foliate-js/view.js",
        ],
        include: [
            // Pre-bundle PDF.js for better performance
            "pdfjs-dist",
        ],
    },

    // Build configuration
    build: {
        assetsInlineLimit: 0,
        rollupOptions: {
            output: {
                manualChunks: {
                    // Separate PDF.js into its own chunk for better caching
                    pdfjs: ["pdfjs-dist"],
                },
            },
        },
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
    },

    // Prevent Vite from obscuring rust errors
    clearScreen: false,

    // Optimize handling of .mjs files
    esbuild: {
        target: "es2022",
    },
}));
