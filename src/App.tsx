import { Suspense, lazy, useEffect } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { AppTitlebar } from "@/components/AppTitlebar";
import { Sidebar } from "@/components/layout";
import { useUIStore, useSettingsStore } from "@/store";
import { isTauri } from "@/lib/env";
import { cn } from "@/lib/utils";
import { initReaderStyles } from "@/lib/reader-styles";

const LibraryPage = lazy(() =>
    import("@/pages/Library").then((module) => ({ default: module.LibraryPage })),
);
const ReaderPage = lazy(() =>
    import("@/pages/Reader").then((module) => ({ default: module.ReaderPage })),
);
const ShelvesPage = lazy(() =>
    import("@/pages/Shelves").then((module) => ({ default: module.ShelvesPage })),
);
const AnnotationsPage = lazy(() =>
    import("@/pages/Annotations").then((module) => ({ default: module.AnnotationsPage })),
);
const BookmarksPage = lazy(() =>
    import("@/pages/Bookmarks").then((module) => ({ default: module.BookmarksPage })),
);
const SettingsPage = lazy(() =>
    import("@/pages/Settings").then((module) => ({ default: module.SettingsPage })),
);
const StatisticsPage = lazy(() =>
    import("@/pages/Statistics").then((module) => ({ default: module.StatisticsPage })),
);
const DESKTOP_STARTUP_MIN_WIDTH = 1024;
const DESKTOP_STARTUP_MIN_HEIGHT = 720;

function PageFallback() {
    return (
        <div className="flex h-full w-full items-center justify-center text-[var(--color-text-secondary)]">
            Loading...
        </div>
    );
}

function App() {
    const currentRoute = useUIStore((state) => state.currentRoute);
    const sidebarOpen = useUIStore((state) => state.sidebarOpen);
    const toggleSidebar = useUIStore((state) => state.toggleSidebar);
    const isTauriRuntime = isTauri();

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

    const renderPage = () => {
        switch (currentRoute) {
            case "library":
                return <LibraryPage />;
            case "reader":
                return <ReaderPage />;
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
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <AppTitlebar title="Lion Reader" onMenuClick={toggleSidebar} />

                {/* Page Content */}
                <main className="flex-1 overflow-y-auto">
                    <Suspense fallback={<PageFallback />}>
                        {renderPage()}
                    </Suspense>
                </main>
            </div>
        </div>
    );
}

export default App;
