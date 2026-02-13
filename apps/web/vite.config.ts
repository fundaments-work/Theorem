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
                    src: "../../node_modules/pdfjs-dist/cmaps/*",
                    dest: "pdfjs/cmaps",
                },
                {
                    src: "../../node_modules/pdfjs-dist/standard_fonts/*",
                    dest: "pdfjs/standard_fonts",
                },
            ],
        }),
    ],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
            "@theorem/core": fileURLToPath(new URL("../../packages/core/src", import.meta.url)),
            "@theorem/ui": fileURLToPath(new URL("../../packages/ui/src", import.meta.url)),
            "@theorem/feature-reader": fileURLToPath(new URL("../../packages/features/reader/src", import.meta.url)),
            "@theorem/feature-library": fileURLToPath(new URL("../../packages/features/library/src", import.meta.url)),
            "@theorem/feature-settings": fileURLToPath(new URL("../../packages/features/settings/src", import.meta.url)),
            "@theorem/feature-statistics": fileURLToPath(new URL("../../packages/features/statistics/src", import.meta.url)),
            "@theorem/feature-vocabulary": fileURLToPath(new URL("../../packages/features/vocabulary/src", import.meta.url)),
            "@theorem/feature-learning": fileURLToPath(new URL("../../packages/features/learning/src", import.meta.url)),
            "@theorem/feature-feeds": fileURLToPath(new URL("../../packages/features/feeds/src", import.meta.url)),
            "@foliate-js": fileURLToPath(new URL("../../packages/features/reader/foliate-js", import.meta.url)),
        },
    },

    // Optimize dependencies for faster dev server startup
    optimizeDeps: {
        exclude: [
            // Foliate-js handles its own imports
            "../../packages/features/reader/foliate-js/mobi.js",
            "../../packages/features/reader/foliate-js/fb2.js",
            "../../packages/features/reader/foliate-js/comic-book.js",
            "../../packages/features/reader/foliate-js/view.js",
        ],
        include: [
            // Pre-bundle PDF.js for better performance
            "pdfjs-dist",
        ],
    },

    // Build configuration
    build: {
        target: "esnext",
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
        fs: {
            allow: [
                // Allow serving files from the app's own root (index.html, src/, etc.)
                ".",
                // Allow serving files from the packages directory
                "../../packages",
                // Allow serving files from the monorepo root (node_modules, etc.)
                "../..",
            ],
        },
    },

    // Prevent Vite from obscuring rust errors
    clearScreen: false,

    // Optimize handling of .mjs files
    esbuild: {
        target: "es2022",
    },
}));
