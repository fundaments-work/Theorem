import os

path = 'apps/web/vite.config.ts'
with open(path, 'r') as f:
    content = f.read()

# We need to find the messed up block and replace it.
# It starts around line 29.
# We can search for `alias: {` and replace until `},`.
import re

new_alias_block = """alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
            "@lionreader/core": fileURLToPath(new URL("../../packages/core/src", import.meta.url)),
            "@lionreader/ui": fileURLToPath(new URL("../../packages/ui/src", import.meta.url)),
            "@lionreader/feature-reader": fileURLToPath(new URL("../../packages/features/reader/src", import.meta.url)),
            "@lionreader/feature-library": fileURLToPath(new URL("../../packages/features/library/src", import.meta.url)),
            "@lionreader/feature-settings": fileURLToPath(new URL("../../packages/features/settings/src", import.meta.url)),
            "@lionreader/feature-statistics": fileURLToPath(new URL("../../packages/features/statistics/src", import.meta.url)),
            "@lionreader/feature-vocabulary": fileURLToPath(new URL("../../packages/features/vocabulary/src", import.meta.url)),
            "@lionreader/feature-learning": fileURLToPath(new URL("../../packages/features/learning/src", import.meta.url)),
            "@/foliate-js": fileURLToPath(new URL("../../packages/features/reader/foliate-js", import.meta.url)),
        },"""

# Regex to capture the alias block, including the messed up content
# It starts with `alias: {` and ends with `},`.
# Since `},` appears inside the messed up block? No.
# Line 41 in view_file: `        },`.
# So `alias: \{[\s\S]*?\},\s*\},`? No.
# `alias: \{` ... `\},` (non-greedy)
# Wait, `resolve: { alias: { ... }, },`.
# So we match `alias:\s*\{` up to the matching closing brace? Hard with regex.
# But we can assume indentation? `        },` on line 41.

# Let's search for `alias: {` and finding the next `},` that is `        },` (8 spaces).
# Or just replace the whole file content since we saw it.

# I'll construct the file content properly.
header = """import { defineConfig } from "vite";
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
"""

footer = """    },

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
"""

full_content = header + "        " + new_alias_block + "\n" + footer

with open(path, 'w') as f:
    f.write(full_content)
