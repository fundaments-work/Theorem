import { Suspense, lazy, useCallback, useEffect, useRef } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { AppTitlebar, Sidebar, BottomNav } from "./shell";
import {
    useUIStore,
    useLibraryStore,
    useSettingsStore,
    isTauriDesktop,
    isTauri,
    isMobile,
    initReaderStyles,
    ensureResponderSyncReady,
    cn,
    importBooksIncremental,
    getBookFormat,
    isImportFormatSupported,
    normalizeFilePath,
} from "./core";
import { prewarmPdfJsRuntime } from "./core/lib/pdfjs-runtime";
import { OnboardingFlow } from "./features/onboarding";

const LibraryPage = lazy(() =>
    import("./features/library").then((module) => ({ default: module.LibraryPage })),
);
const loadReaderPage = () => import("./features/reader");
const ReaderPage = lazy(() =>
    loadReaderPage().then((module) => ({ default: module.ReaderPage })),
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

function ReaderFallback() {
    return (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-[var(--color-background)]">
            <div className="w-12 h-12 border-3 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
            <p className="mt-4 text-sm text-[color:var(--color-text-muted)]">Opening reader...</p>
        </div>
    );
}

function App() {
    const currentRoute = useUIStore((state) => state.currentRoute);
    const setRoute = useUIStore((state) => state.setRoute);
    const isDesktopTauriRuntime = isTauriDesktop();
    const isTauriRuntime = isTauri();
    const mainScrollRef = useRef<HTMLElement>(null);
    const vocabularySettings = useSettingsStore((state) => state.settings.vocabulary);
    const vocabularyEnabled = vocabularySettings?.vocabularyEnabled ?? true;
    const hasCompletedOnboarding = useSettingsStore((state) => state.settings.hasCompletedOnboarding);
    const updateSettings = useSettingsStore((state) => state.updateSettings);

    const handleOnboardingComplete = useCallback(() => {
        updateSettings({ hasCompletedOnboarding: true });
    }, [updateSettings]);

    useEffect(() => {
        if (currentRoute === "vocabulary" && !vocabularyEnabled) {
            setRoute("library");
        }
    }, [currentRoute, setRoute, vocabularyEnabled]);

    // Handle system back button / browser history
    useEffect(() => {
        if (typeof window === "undefined") return;

        // Initialize history state for the initial landing page
        window.history.replaceState({ route: currentRoute, bookId: useUIStore.getState().currentBookId }, "");

        const handlePopState = (event: PopStateEvent) => {
            const state = event.state;
            const currentUIState = useUIStore.getState();

            // Ignore our internal back interceptor states
            if (state && state.__theorem_back) {
                return;
            }

            if (state && state.route) {
                // Only update if the route or book has actually changed
                if (state.route !== currentUIState.currentRoute || state.bookId !== currentUIState.currentBookId) {
                    setRoute(state.route, state.bookId, false);
                }
            } else if (!state) {
                // If we land on a null state (beginning of history), default to library
                if (currentUIState.currentRoute !== "library") {
                    setRoute("library", undefined, false);
                }
            }
        };

        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, [setRoute]); // Only setup once, but include setRoute in deps for safety

    // Handle desktop file associations ("Open With Theorem") via Tauri.
    useEffect(() => {
        if (!isTauriRuntime || typeof window === "undefined") {
            return;
        }

        let cancelled = false;
        let unlistenPromise: Promise<() => void> | null = null;

        const openPaths = async (paths: string[]) => {
            if (cancelled || paths.length === 0) {
                return;
            }

            const uniquePaths = Array.from(
                new Set(paths.map((path) => path.trim()).filter(Boolean)),
            );

            for (const rawPath of uniquePaths) {
                if (cancelled) {
                    return;
                }

                const normalizedPath = normalizeFilePath(rawPath);
                const format = getBookFormat(normalizedPath);
                if (!format || !isImportFormatSupported(format)) {
                    continue;
                }

                const existing = useLibraryStore
                    .getState()
                    .books
                    .find((book) => normalizeFilePath(book.filePath) === normalizedPath);

                if (existing) {
                    useUIStore.getState().setRoute("reader", existing.id);
                    continue;
                }

                const failures: Array<{ source: string; message: string }> = [];
                const imported = await importBooksIncremental(
                    [normalizedPath],
                    (book) => {
                        useLibraryStore.getState().addBook(book);
                    },
                    (source, error) => {
                        failures.push({
                            source,
                            message: error instanceof Error ? error.message : String(error),
                        });
                    },
                );

                if (cancelled) {
                    return;
                }

                const importedBook = imported[0];
                if (importedBook) {
                    useUIStore.getState().setRoute("reader", importedBook.id);
                } else if (failures.length > 0) {
                    window.alert(`Failed to open file.\n\n${failures[0]?.source}\n${failures[0]?.message}`);
                }
            }
        };

        const initOpenWith = async () => {
            try {
                const { invoke } = await import("@tauri-apps/api/core");
                const pending = await invoke<unknown>("take_pending_open_files");
                if (Array.isArray(pending)) {
                    await openPaths(pending.filter((value): value is string => typeof value === "string"));
                }
            } catch (error) {
                console.warn("[App] Failed to fetch pending open files:", error);
            }

            try {
                const { listen } = await import("@tauri-apps/api/event");
                unlistenPromise = listen<unknown>("theorem://open-files", (event) => {
                    const payload = event.payload;
                    const paths = Array.isArray(payload)
                        ? payload.filter((value): value is string => typeof value === "string")
                        : typeof payload === "string"
                            ? [payload]
                            : [];
                    void openPaths(paths);
                });
            } catch (error) {
                console.warn("[App] Failed to listen for open-file events:", error);
            }
        };

        void initOpenWith();

        return () => {
            cancelled = true;
            if (unlistenPromise) {
                void unlistenPromise.then((unlisten) => unlisten());
            }
        };
    }, [isTauriRuntime]);

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
            void loadReaderPage();
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

    // Keep responder sync infrastructure ready globally so incoming peer sync
    // can merge without requiring users to open the Settings screen.
    useEffect(() => {
        if (!isTauriRuntime || !hasCompletedOnboarding) {
            return;
        }

        let cancelled = false;
        const bootstrapResponderSync = async () => {
            try {
                await ensureResponderSyncReady();
            } catch (error) {
                if (!cancelled) {
                    console.warn("[App] Failed to bootstrap responder sync:", error);
                }
            }
        };

        void bootstrapResponderSync();
        return () => {
            cancelled = true;
        };
    }, [hasCompletedOnboarding, isTauriRuntime]);

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
    // Onboarding flow for first-time users
    if (!hasCompletedOnboarding) {
        return <OnboardingFlow onComplete={handleOnboardingComplete} />;
    }

    if (isReaderMode) {
        return (
            <Suspense fallback={<ReaderFallback />}>
                <ReaderPage />
            </Suspense>
        );
    }

    const isMobileDevice = isMobile();

    return (
        <div className="flex h-screen min-h-[100dvh] bg-[var(--color-background)]">
            {/* Sidebar - Shows on md screens and up (tablets and laptops) */}
            <div className="hidden md:block">
                <Sidebar isMobile={isMobileDevice} />
            </div>

            {/* Main Content */}
            <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden">
                <AppTitlebar title="Theorem" />

                {/* Page Content */}
                <main ref={mainScrollRef} className="flex-1 overflow-y-auto pb-16 md:pb-0 md:px-8 md:py-6 custom-scrollbar">
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
