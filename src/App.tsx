import { Suspense, lazy, useEffect, useRef } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { AppTitlebar, Sidebar, BottomNav } from "./shell";
import {
    useUIStore,
    useSettingsStore,
} from "./core";
import { isTauriDesktop } from "./core";
import { initReaderStyles } from "./core";
import { prewarmPdfJsRuntime } from "./core/lib/pdfjs-runtime";

const LibraryPage = lazy(() =>
    import("./features/library").then((module) => ({ default: module.LibraryPage })),
);
const ReaderPage = lazy(() =>
    import("./features/reader").then((module) => ({ default: module.ReaderPage })),
);
const VocabularyPage = lazy(() =>
    import("./features/vocabulary").then((module) => ({ default: module.VocabularyPage })),
);
const ShelvesPage = lazy(() =>
    import("./features/library").then((module) => ({ default: module.ShelvesPage })),
);
const AnnotationsPage = lazy(() =>
    import("./features/library").then((module) => ({ default: module.AnnotationsPage })),
);
const BookmarksPage = lazy(() =>
    import("./features/library").then((module) => ({ default: module.BookmarksPage })),
);
const SettingsPage = lazy(() =>
    import("./features/settings").then((module) => ({ default: module.SettingsPage })),
);
const StatisticsPage = lazy(() =>
    import("./features/statistics").then((module) => ({ default: module.StatisticsPage })),
);
const FeedsPage = lazy(() =>
    import("./features/feeds").then((module) => ({ default: module.FeedsPage })),
);
const DESKTOP_STARTUP_MIN_WIDTH = 1024;
const DESKTOP_STARTUP_MIN_HEIGHT = 720;

function PageFallback() {
    return (
        <div className="flex h-full w-full items-center justify-center text-[color:var(--color-text-secondary)]">
            Loading...
        </div>
    );
}

function App() {
    const currentRoute = useUIStore((state) => state.currentRoute);
    const setRoute = useUIStore((state) => state.setRoute);
    const isDesktopTauriRuntime = isTauriDesktop();
    const mainScrollRef = useRef<HTMLElement>(null);
    const vocabularySettings = useSettingsStore((state) => state.settings.vocabulary);
    const vocabularyEnabled = vocabularySettings?.vocabularyEnabled ?? true;

    useEffect(() => {
        if (currentRoute === "vocabulary" && !vocabularyEnabled) {
            setRoute("library");
        }
    }, [currentRoute, setRoute, vocabularyEnabled]);

    // Initialize reader styles on app load
    useEffect(() => {
        initReaderStyles(useSettingsStore.getState().settings.readerSettings);
    }, []); // Only on mount - the store's onRehydrate will handle persisted settings

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        type IdleCapableWindow = Window & typeof globalThis & {
            requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
            cancelIdleCallback?: (handle: number) => void;
        };

        const idleWindow = window as IdleCapableWindow;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let idleHandle: number | null = null;
        let cancelled = false;

        const warmPdfRuntime = () => {
            if (cancelled) {
                return;
            }
            void prewarmPdfJsRuntime();
        };

        if (idleWindow.requestIdleCallback) {
            idleHandle = idleWindow.requestIdleCallback(
                () => warmPdfRuntime(),
                { timeout: 1800 },
            );
        } else {
            timeoutId = setTimeout(warmPdfRuntime, 900);
        }

        return () => {
            cancelled = true;
            if (idleHandle !== null && idleWindow.cancelIdleCallback) {
                idleWindow.cancelIdleCallback(idleHandle);
            }
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
        };
    }, []);

    // Ensure the desktop window doesn't start in a mobile-like size.
    useEffect(() => {
        if (!isDesktopTauriRuntime) {
            return;
        }

        let cancelled = false;
        const ensureDesktopWindowSize = async () => {
            try {
                const win = getCurrentWebviewWindow();
                const size = await win.innerSize();
                if (cancelled) {
                    return;
                }

                if (
                    size.width < DESKTOP_STARTUP_MIN_WIDTH
                    || size.height < DESKTOP_STARTUP_MIN_HEIGHT
                ) {
                    await win.maximize();
                }
            } catch (error) {
                console.error("[App] Failed to enforce startup window size:", error);
            }
        };

        void ensureDesktopWindowSize();
        return () => {
            cancelled = true;
        };
    }, [isDesktopTauriRuntime]);

    // Check if we're in reader mode (full screen, no sidebar)
    const isReaderMode = currentRoute === "reader";

    // Reset scroll position when navigating between non-reader pages.
    useEffect(() => {
        if (isReaderMode) {
            return;
        }
        mainScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }, [currentRoute, isReaderMode]);

    const renderPage = () => {
        switch (currentRoute) {
            case "library":
                return <LibraryPage />;
            case "reader":
                return <ReaderPage />;
            case "vocabulary":
                return <VocabularyPage />;
            case "shelves":
                return <ShelvesPage />;
            case "annotations":
                return <AnnotationsPage />;
            case "bookmarks":
                return <BookmarksPage />;
            case "settings":
                return <SettingsPage />;
            case "statistics":
                return <StatisticsPage />;
            case "feeds":
                return <FeedsPage />;
            default:
                return <LibraryPage />;
        }
    };

    // Reader mode: full screen without sidebar
    if (isReaderMode) {
        return (
            <Suspense fallback={<PageFallback />}>
                <ReaderPage />
            </Suspense>
        );
    }

    return (
        <div className="flex h-screen min-h-[100dvh] bg-[var(--color-background)]">
            {/* Sidebar - Shows on md screens and up (tablets and laptops) */}
            <div className="hidden md:block">
                <Sidebar />
            </div>

            {/* Main Content */}
            <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden">
                <AppTitlebar title="Theorem" />

                {/* Page Content */}
                <main ref={mainScrollRef} className="flex-1 overflow-y-auto pb-16 md:pb-0">
                    <Suspense fallback={<PageFallback />}>
                        {renderPage()}
                    </Suspense>
                </main>

                {/* Mobile Navigation */}
                <BottomNav />
            </div>
        </div>
    );
}

export default App;
