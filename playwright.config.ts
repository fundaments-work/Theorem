import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    timeout: 30000,
    retries: 1,
    use: {
        baseURL: "http://localhost:1420",
        headless: true,
        viewport: { width: 1440, height: 900 },
    },
    webServer: {
        command: "pnpm dev",
        port: 1420,
        reuseExistingServer: true,
        timeout: 30000,
    },
});
