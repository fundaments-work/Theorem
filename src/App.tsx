import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { RouteErrorBoundary, KeyboardShortcutsHelp, ContextMenuRoot } from "./ui";
import { AppTitlebar, Sidebar, BottomNav } from "./shell";
import { useUIStore, useLibraryStore, useSettingsStore } from "./core/store";
import { isTauriDesktop, isTauri, isMobile } from "./core/lib/env";
import { initReaderStyles } from "./core/lib/design-tokens";
import { ensureResponderSyncReady, startAutoSync, stopAutoSync } from "./core/lib/sync-orchestrator";
import { importBooksIncremental, getBookFormat, isImportFormatSupported } from "./core/lib/import";
import { normalizeFilePath } from "./core/lib/utils";
import { registerShortcuts, useKeyboardShortcuts } from "./core/lib/keyboard-shortcuts";
import { initI18n } from "./core/lib/i18n";
import { OnboardingFlow } from "./features/onboarding";
import { Toaster } from "sonner";

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
        <div className="flex h-full w-full items-center justify-center">
            <div className="w-8 h-8 border-3 border-[var(--color-border)] border-t-[var(--color-accent)] rounded-full animate-spin" />
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
    const mainScrollRef = useRef<HTMLElement>(null);
    const vocabularySettings = useSettingsStore((state) => state.settings.vocabulary);
    const vocabularyEnabled = vocabularySettings?.vocabularyEnabled ?? true;
    const autoSyncEnabled = useSettingsStore((state) => state.settings.deviceSync?.autoSyncEnabled ?? true);
    const updateSettings = useSettingsStore((state) => state.updateSettings);
    const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

    // Wait for settings store to hydrate from SQLite (max 3s) before
    // deciding whether to show onboarding. Falls through so the app
    // never gets stuck — if hydration doesn't complete in time, the
    // default hasCompletedOnboarding:true kicks in.
    const [storesHydrated, setStoresHydrated] = useState(() =>
        useSettingsStore.persist.hasHydrated(),
    );

    useEffect(() => {
        if (storesHydrated) return;
        let cancelled = false;
        const done = () => { if (!cancelled) setStoresHydrated(true); };
        const timeout = setTimeout(done, 3000);
        const unsub = useSettingsStore.subscribe(() => {
            if (cancelled) return;
            if (useSettingsStore.persist.hasHydrated()) {
                clearTimeout(timeout);
                done();
            }
        });
        return () => {
            cancelled = true;
            clearTimeout(timeout);
            unsub();
        };
    }, [storesHydrated]);

    const hasCompletedOnboardingStore = useSettingsStore(
        (state) => state.settings.hasCompletedOnboarding,
    );
    // localStorage is synchronous — instant check prevents the onboarding
    // flash while SQLite hydration is still in progress.
    const hasCompletedOnboarding =
        typeof localStorage !== "undefined" &&
        localStorage.getItem("theorem-onboarding-complete") === "true"
            ? true
            : hasCompletedOnboardingStore;

    useKeyboardShortcuts(currentRoute);

    // Register app-level keyboard shortcuts
    useEffect(() => {
        return registerShortcuts("app", [
            {
                label: "Show keyboard shortcuts",
                keys: "Shift+?",
                category: "App",
                handler: () => setShowShortcutsHelp((prev) => !prev),
            },
            // Navigation
            { label: "Go to Library",       keys: "Ctrl+1", category: "Navigation", handler: () => setRoute("library") },
            { label: "Go to Shelves",       keys: "Ctrl+2", category: "Navigation", handler: () => setRoute("shelves") },
            { label: "Go to Feeds",         keys: "Ctrl+3", category: "Navigation", handler: () => setRoute("feeds") },
            { label: "Go to Vocabulary",    keys: "Ctrl+4", category: "Navigation", handler: () => setRoute("vocabulary") },
            { label: "Go to Statistics",    keys: "Ctrl+5", category: "Navigation", handler: () => setRoute("statistics") },
            { label: "Go to Workbench",     keys: "Ctrl+6", category: "Navigation", handler: () => setRoute("annotations") },
            { label: "Go to Bookmarks",     keys: "Ctrl+7", category: "Navigation", handler: () => setRoute("bookmarks") },
            { label: "Go to Settings",      keys: "Ctrl+,", category: "Navigation", handler: () => setRoute("settings") },
            // Search & Filter
            { label: "Find / Search",       keys: "Ctrl+F", category: "Search",     handler: () => {
                const route = useUIStore.getState().currentRoute;
                if (route === "reader") return; // handled by reader engine
                const searchInput = document.querySelector<HTMLInputElement>('input[placeholder*="Search"]');
                if (searchInput) { searchInput.focus(); searchInput.select(); }
            }},
            // Sidebar
            { label: "Toggle sidebar",      keys: "Ctrl+B", category: "App",        handler: () => {
                useUIStore.getState().toggleSidebar();
            }},
            // Library actions
            { label: "Select all",          keys: "Ctrl+A", category: "Library",    handler: () => {
                const route = useUIStore.getState().currentRoute;
                if (route !== "library" && route !== "shelves" && route !== "bookmarks") return;
                const toggleSelectMode = (document.querySelector('[data-action="toggle-select-mode"]') as HTMLButtonElement);
                if (toggleSelectMode) toggleSelectMode.click();
            }},
        ]);
    }, [setRoute]);

    const handleOnboardingComplete = useCallback(() => {
        updateSettings({ hasCompletedOnboarding: true });
        if (typeof localStorage !== "undefined") {
            localStorage.setItem("theorem-onboarding-complete", "true");
        }
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
        if (!isTauri() || typeof window === "undefined") {
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
                } else {
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
            }
        };

        void initOpenWith();

        return () => {
            cancelled = true;
            if (unlistenPromise) {
                void unlistenPromise.then((unlisten) => unlisten());
            }
        };
    }, []);

    // Initialize reader styles on app load
    useEffect(() => {
        initReaderStyles(useSettingsStore.getState().settings.readerSettings);
    }, []);

    // Reader runtime prewarming removed — PDF.js + Foliate + ReaderPage are
    // heavy libraries (~100-200MB). For low-resource environments, they load
    // on-demand when the user opens a book, not at app startup.

    // Initialize i18n on app load
    useEffect(() => {
        void initI18n();
    }, []);

    // On Android, initialize the device fingerprint (ANDROID_ID) for stable
    // device identity across installs. No-op on desktop where machine-id is used.
    useEffect(() => {
        if (!isTauri()) {
            return;
        }
        const initFingerprint = async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("set_android_fingerprint").catch(e => console.error("[catch]", e));
        };
        void initFingerprint();
    }, []);

    // Start the iroh P2P endpoint + auto-sync scheduler when auto-sync is enabled.
    // The iroh endpoint is also started on-demand from DeviceSync.tsx when the
    // user opens the sync settings page (for pairing/manual sync).
    useEffect(() => {
        if (!isTauri() || !hasCompletedOnboarding) {
            return;
        }

        let cancelled = false;
        let bridgeCleanup: (() => void) | null = null;
        const bootstrap = async () => {
            if (cancelled) {
                return;
            }

            // Always start the iroh responder + bridge so the device can
            // receive incoming sync, and Zustand mutations are written to
            // iroh-docs even when auto-sync is off. Without this, manual
            // "Sync Now" would miss any changes made since the last sync
            // because the bridge (subscribeZustandToIrohDocs) was never set up.
            try {
                await ensureResponderSyncReady();
            } catch {
                // Sync server unavailable on this device.
            }
            if (cancelled) return;

            try {
                const { subscribeZustandToIrohDocs } = await import("./core/lib/sync-orchestrator");
                bridgeCleanup = subscribeZustandToIrohDocs();
            } catch {
                // Bridge initialization not available.
            }

            // Auto-sync (periodic background sync) only runs when enabled.
            if (autoSyncEnabled) {
                try {
                    await startAutoSync();
                } catch {
                    // Auto-sync scheduling unavailable.
                }
            }
        };

        const timer = setTimeout(() => {
            void bootstrap();
        }, 2000);

        return () => {
            cancelled = true;
            clearTimeout(timer);
            bridgeCleanup?.();
            stopAutoSync();
        };
    }, [hasCompletedOnboarding, autoSyncEnabled]);

    // Ensure the desktop window doesn't start in a mobile-like size.
    useEffect(() => {
        if (!isTauriDesktop()) {
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
            }
        };

        void ensureDesktopWindowSize();
        return () => {
            cancelled = true;
        };
    }, []);

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

    // Show loading state until persisted stores have rehydrated from SQLite.
    // This prevents the default hasCompletedOnboarding:false from flashing
    // the OnboardingFlow before the persisted true value is loaded.
    if (!storesHydrated) {
        return <PageFallback />;
    }

    // Reader mode: full screen without sidebar
    // Onboarding flow for first-time users
    if (!hasCompletedOnboarding) {
        return <OnboardingFlow onComplete={handleOnboardingComplete} />;
    }

    if (isReaderMode) {
        return (
            <RouteErrorBoundary>
                <Suspense fallback={<ReaderFallback />}>
                    <ReaderPage />
                </Suspense>
            </RouteErrorBoundary>
        );
    }

    const isMobileDevice = isMobile();

    return (
        <>
        <div className="flex h-screen min-h-[100dvh] bg-[var(--color-background)]">
            {/* Sidebar - Shows on md screens and up (tablets and laptops) */}
            <div className="hidden md:block">
                <Sidebar isMobile={isMobileDevice} />
            </div>

            {/* Main Content */}
            <div className="relative flex-1 flex flex-col min-w-0">
                <AppTitlebar title="Theorem" />

                {/* Page Content */}
                <main id="app-main" ref={mainScrollRef} className="flex-1 overflow-y-auto pb-16 md:pb-0 md:px-8 md:py-6 custom-scrollbar">
                    <RouteErrorBoundary>
                        <Suspense fallback={<PageFallback />}>
                            {renderPage()}
                        </Suspense>
                    </RouteErrorBoundary>
                </main>
            </div>

            {/* Mobile Navigation - outside overflow container for reliable fixed positioning on all mobile browsers */}
            <BottomNav />

            <KeyboardShortcutsHelp
                isOpen={showShortcutsHelp}
                onClose={() => setShowShortcutsHelp(false)}
            />
            
            <ContextMenuRoot />
        </div>
            <Toaster position="bottom-right" />
        </>
    );
}

export default App;
