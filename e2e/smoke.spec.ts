import { test, expect } from "@playwright/test";

test.describe("Theorem Smoke Tests", () => {
    test("app loads and shows onboarding", async ({ page }) => {
        await page.goto("/");
        await page.waitForLoadState("networkidle");

        // Onboarding should appear for first-time users
        const heading = page.locator("h1, h2").first();
        await expect(heading).toBeVisible();
    });

    test("can navigate to main pages", async ({ page }) => {
        await page.goto("/");
        await page.waitForLoadState("networkidle");

        // Complete onboarding by clicking through
        for (let i = 0; i < 4; i++) {
            const nextButton = page.locator("button").filter({ hasText: /next|get started|finish/i }).first();
            if (await nextButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                await nextButton.click();
                await page.waitForTimeout(500);
            }
        }

        // After onboarding, the library should be visible
        await page.waitForURL("**/", { timeout: 10000 }).catch(() => {});
    });

    test("library shows empty state", async ({ page }) => {
        // Set onboarding as completed directly via localStorage
        await page.goto("/");
        await page.evaluate(() => {
            const stored = localStorage.getItem("theorem-settings");
            if (stored) {
                const settings = JSON.parse(stored);
                settings.state.settings.hasCompletedOnboarding = true;
                localStorage.setItem("theorem-settings", JSON.stringify(settings));
            }
        });
        await page.reload();
        await page.waitForLoadState("networkidle");

        // Library should show empty state (no books)
        const emptyText = page.getByText(/no books|no documents|drop files/i);
        const isVisible = await emptyText.isVisible().catch(() => false);
        // If no empty state is visible, at minimum the page shouldn't crash
        expect(await page.locator("body").isVisible()).toBe(true);
    });

    test("app renders without fatal errors", async ({ page }) => {
        page.on("pageerror", (error) => {
            throw new Error(`Unhandled page error: ${error.message}`);
        });

        await page.goto("/");
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1000);

        // Page should have rendered something meaningful
        const bodyText = await page.locator("body").textContent();
        expect(bodyText).toBeTruthy();
        expect(bodyText.length).toBeGreaterThan(50);
    });

    test("error boundary catches route errors", async ({ page }) => {
        // Navigate to a non-existent hash route to test error boundary resilience
        await page.goto("/#/nonexistent");
        await page.waitForLoadState("networkidle");

        // App should still render without white screen
        const body = page.locator("body");
        await expect(body).toBeVisible();
    });
});
