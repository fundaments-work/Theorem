import { Suspense, lazy, useEffect, useRef } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { AppTitlebar } from "@theorem/ui";
import { ReviewSessionModal } from "@theorem/feature-learning";
import { Sidebar } from "@theorem/ui";
import {
    useLearningStore,
    useLibraryStore,
    useUIStore,
    useSettingsStore,
} from "@theorem/core";
import { isTauri } from "@theorem/core";
import { cn } from "@theorem/core";
import { initReaderStyles } from "@theorem/core";
import { useDailyReviewReminder } from "@theorem/core";

const LibraryPage = lazy(() =>
    import("@theorem/feature-library").then((module) => ({ default: module.LibraryPage })),
);
const ReaderPage = lazy(() =>
    import("@theorem/feature-reader").then((module) => ({ default: module.ReaderPage })),
);
const VocabularyPage = lazy(() =>
    import("@theorem/feature-vocabulary").then((module) => ({ default: module.VocabularyPage })),
);
const ShelvesPage = lazy(() =>
    import("@theorem/feature-library").then((module) => ({ default: module.ShelvesPage })),
);
const AnnotationsPage = lazy(() =>
    import("@theorem/feature-library").then((module) => ({ default: module.AnnotationsPage })),
);
const BookmarksPage = lazy(() =>
    import("@theorem/feature-library").then((module) => ({ default: module.BookmarksPage })),
);
const SettingsPage = lazy(() =>
    import("@theorem/feature-settings").then((module) => ({ default: module.SettingsPage })),
);
const StatisticsPage = lazy(() =>
    import("@theorem/feature-statistics").then((module) => ({ default: module.StatisticsPage })),
);
const FeedsPage = lazy(() =>
    import("@theorem/feature-feeds").then((module) => ({ default: module.FeedsPage })),
);
const AcademicPage = lazy(() =>
    import("@theorem/feature-academic").then((module) => ({ default: module.AcademicPage })),
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
    const sidebarOpen = useUIStore((state) => state.sidebarOpen);
    const toggleSidebar = useUIStore((state) => state.toggleSidebar);
    const isTauriRuntime = isTauri();
    const mainScrollRef = useRef<HTMLElement>(null);
    const reminderVisible = useLearningStore((state) => state.dailyReminderState.isPromptVisible);
    const dismissDailyReminderPrompt = useLearningStore((state) => state.dismissDailyReminderPrompt);
    const openReviewSession = useLearningStore((state) => state.openReviewSession);
    const syncReviewRecords = useLearningStore((state) => state.syncReviewRecords);
    const learningSettings = useSettingsStore((state) => state.settings.learning);
    const vocabularyEnabled = learningSettings.vocabularyEnabled;
    const reminderScope = learningSettings.defaultReminderReviewScope;
    const dueCount = useLearningStore((state) => (
        state.getDueReviewItems(new Date(), reminderScope).length
    ));

    useDailyReviewReminder();

    useEffect(() => {
        const runSync = () => {
            syncReviewRecords();
        };

        const libraryPersist = (
            useLibraryStore as typeof useLibraryStore & {
                persist?: {
                    hasHydrated?: () => boolean;
                    onFinishHydration?: (callback: () => void) => () => void;
                };
            }
        ).persist;

        if (!libraryPersist || libraryPersist.hasHydrated?.()) {
            runSync();
            return;
        }

        const unsubscribe = libraryPersist.onFinishHydration?.(runSync);
        return () => {
            unsubscribe?.();
        };
    }, [syncReviewRecords]);

    useEffect(() => {
        if (currentRoute === "vocabulary" && !vocabularyEnabled) {
            setRoute("library");
        }
    }, [currentRoute, setRoute, vocabularyEnabled]);

    // Initialize reader styles on app load
    useEffect(() => {
        initReaderStyles(useSettingsStore.getState().settings.readerSettings);
    }, []); // Only on mount - the store's onRehydrate will handle persisted settings

    // Ensure the desktop window doesn't start in a mobile-like size.
    useEffect(() => {
        if (!isTauriRuntime) {
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
    }, [isTauriRuntime]);

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
            case "academic":
                return <AcademicPage />;
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
        <div className="flex h-screen bg-[var(--color-background)]">
            {/* Sidebar - Shows on md screens and up (tablets and laptops) */}
            <div className="hidden md:block">
                <Sidebar />
            </div>

            {/* Mobile sidebar overlay - only on small screens */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-[var(--z-backdrop)] bg-[var(--color-overlay-strong)] md:hidden"
                    onClick={toggleSidebar}
                />
            )}

            {/* Mobile sidebar - only on small screens */}
            <div
                className={cn(
                    "fixed left-0 top-0 h-full z-[calc(var(--z-dropdown)+1)] md:hidden",
                    "transform transition-transform duration-300",
                    sidebarOpen ? "translate-x-0" : "-translate-x-full",
                )}
            >
                <Sidebar isMobile onClose={toggleSidebar} />
            </div>

            {/* Main Content */}
            <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden">
                <AppTitlebar title="Theorem" onMenuClick={toggleSidebar} />

                {/* Page Content */}
                <main ref={mainScrollRef} className="flex-1 overflow-y-auto">
                    <Suspense fallback={<PageFallback />}>
                        {renderPage()}
                    </Suspense>
                </main>

                {reminderVisible && dueCount > 0 && (
                    <div className="pointer-events-none absolute bottom-4 right-4 z-[var(--z-toast)]">
                        <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-lg)]">
                            <div className="text-sm">
                                <p className="font-semibold text-[color:var(--color-text-primary)]">Daily review ready</p>
                                <p className="text-[color:var(--color-text-secondary)]">
                                    {dueCount} review item{dueCount === 1 ? "" : "s"} are due now.
                                </p>
                            </div>
                            <button
                                onClick={() => {
                                    openReviewSession(reminderScope);
                                    dismissDailyReminderPrompt();
                                }}
                                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium ui-text-accent-contrast"
                            >
                                Start
                            </button>
                            <button
                                onClick={dismissDailyReminderPrompt}
                                className="rounded-md bg-[var(--color-surface-muted)] px-2 py-1 text-xs text-[color:var(--color-text-secondary)]"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                )}
            </div>
            <ReviewSessionModal />
        </div>
    );
}

export default App;
