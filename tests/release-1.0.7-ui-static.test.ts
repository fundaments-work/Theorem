import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ─── CSS Performance Rules ───

describe("CSS: no snap-x snap-mandatory in our code", () => {
    it("no snap-x in application source files", () => {
        const indexCss = readFileSync(resolve("src/index.css"), "utf-8");
        // snap-x should NOT exist in our CSS sources
        expect(indexCss).not.toContain("snap-x");
        // But it SHOULD exist in vendored foliate-js (no check here)
    });
});

describe("CSS: content-visibility on scroll containers", () => {
    it("#app-main has content-visibility: auto", () => {
        const indexCss = readFileSync(resolve("src/index.css"), "utf-8");
        expect(indexCss).toContain("#app-main");
        expect(indexCss).toContain("content-visibility: auto");
    });

    it("#app-main has overscroll-behavior: contain", () => {
        const indexCss = readFileSync(resolve("src/index.css"), "utf-8");
        expect(indexCss).toContain("overscroll-behavior: contain");
    });

    it("#app-main has -webkit-overflow-scrolling: touch", () => {
        const indexCss = readFileSync(resolve("src/index.css"), "utf-8");
        expect(indexCss).toContain("-webkit-overflow-scrolling: touch");
    });
});

describe("CSS: animate-fade-in guarded by prefers-reduced-motion", () => {
    it("animate-fade-in inside prefers-reduced-motion media query", () => {
        const indexCss = readFileSync(resolve("src/index.css"), "utf-8");

        // The keyframes and class should be inside a @media block
        const afterMedia = indexCss.split("prefers-reduced-motion: no-preference")[1] || "";
        expect(afterMedia).toContain("fade-in");
    });
});

// ─── Settings UI ───

describe("Settings: tab content uses hidden CSS class", () => {
    it("all 6 tabs use hidden pattern instead of conditional rendering", () => {
        const settingsTsx = readFileSync(
            resolve("src/features/settings/Settings.tsx"),
            "utf-8",
        );
        const hiddenCount = (settingsTsx.match(/"hidden"/g) || []).length;
        // At least 6 tabs × 1 hidden pattern each
        expect(hiddenCount).toBeGreaterThanOrEqual(6);
    });
});

describe("Settings: progress bar uses transition-[width]", () => {
    it("progress bar does not use transition-all", () => {
        const settingsTsx = readFileSync(
            resolve("src/features/settings/Settings.tsx"),
            "utf-8",
        );
        // The progress bar should have transition-[width], not transition-all
        expect(settingsTsx).toContain("transition-[width]");
        // Verify no stray transition-all on the progress bar
        const progressSection = settingsTsx.split("yearlyBookGoal")[1] || "";
        expect(progressSection).not.toContain("transition-all");
    });
});

// ─── React.memo ───

describe("React.memo: key components are memoized", () => {
    it("SettingsPage is memoized", () => {
        const settingsTsx = readFileSync(
            resolve("src/features/settings/Settings.tsx"),
            "utf-8",
        );
        expect(settingsTsx).toContain("memo(function SettingsPage");
    });

    it("ArticleViewer is memoized", () => {
        const articleTsx = readFileSync(
            resolve("src/features/reader/article-reader/ArticleViewer.tsx"),
            "utf-8",
        );
        expect(articleTsx).toContain("memo(function ArticleViewer");
    });
});

// ─── Startup ───

describe("Startup: loader HTML", () => {
    it("index.html has inline spinner", () => {
        const html = readFileSync(resolve("index.html"), "utf-8");
        expect(html).toContain("theorem-loader-spin");
        expect(html).toContain("root:empty");
        expect(html).toContain("Theorem");
    });
});

describe("Startup: tauri.conf.json visible: false", () => {
    it("window config has visible: false", () => {
        const conf = readFileSync(resolve("src-tauri/tauri.conf.json"), "utf-8");
        expect(conf).toContain('"visible": false');
    });
});

// ─── ArticleViewer annotations selector ───

describe("ArticleViewer: per-book annotation selector", () => {
    it("uses useShallow with getBookAnnotations instead of full annotations array", () => {
        const articleTsx = readFileSync(
            resolve("src/features/reader/article-reader/ArticleViewer.tsx"),
            "utf-8",
        );
        expect(articleTsx).toContain("getBookAnnotations");
        expect(articleTsx).toContain("useShallow");
    });
});
