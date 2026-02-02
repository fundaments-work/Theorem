import { useEffect } from "react";
import { AppTitlebar } from "@/components/AppTitlebar";
import { Sidebar } from "@/components/layout";
// Direct imports to avoid barrel export issues
import { LibraryPage } from "@/pages/Library";
import { ReaderPage } from "@/pages/Reader";
import { ShelvesPage } from "@/pages/Shelves";
import { AnnotationsPage } from "@/pages/Annotations";
import { BookmarksPage } from "@/pages/Bookmarks";
import { SettingsPage } from "@/pages/Settings";
import { StatisticsPage } from "@/pages/Statistics";
import { useUIStore, useSettingsStore } from "@/store";
import { cn } from "@/lib/utils";
import { initReaderStyles } from "@/lib/reader-styles";

// Debug: Log imported components
console.log("[App] Imported components (direct):", {
  LibraryPage: typeof LibraryPage,
  ReaderPage: typeof ReaderPage,
  ShelvesPage: typeof ShelvesPage,
  AnnotationsPage: typeof AnnotationsPage,
  BookmarksPage: typeof BookmarksPage,
  SettingsPage: typeof SettingsPage,
  StatisticsPage: typeof StatisticsPage,
});

function App() {
  const { currentRoute, sidebarOpen, toggleSidebar } = useUIStore();
  const { settings } = useSettingsStore();
  
  // Initialize reader styles on app load
  useEffect(() => {
    console.log("[App] Initializing reader styles", settings.readerSettings);
    initReaderStyles(settings.readerSettings);
  }, []); // Only on mount - the store's onRehydrate will handle persisted settings

  // Check if we're in reader mode (full screen, no sidebar)
  const isReaderMode = currentRoute === "reader";
  
  console.log("[App] Current route:", currentRoute, "isReaderMode:", isReaderMode);

  // Render current page based on route
  const renderPage = () => {
    console.log("[App] Rendering page for route:", currentRoute);
    try {
      switch (currentRoute) {
        case "library":
          console.log("[App] Attempting to render LibraryPage, type:", typeof LibraryPage);
          if (typeof LibraryPage !== 'function') {
            console.error("[App] LibraryPage is not a function! Value:", LibraryPage);
            return <div>Error: LibraryPage is not properly imported</div>;
          }
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
          console.log("[App] Rendering default LibraryPage");
          return <LibraryPage />;
      }
    } catch (error) {
      console.error("[App] Error rendering page:", error);
      return (
        <div style={{ padding: "2rem", color: "red" }}>
          <h2>Error rendering page</h2>
          <pre>{error instanceof Error ? error.message : String(error)}</pre>
          <pre>{error instanceof Error ? error.stack : 'No stack trace'}</pre>
        </div>
      );
    }
  };

  // Reader mode: full screen without sidebar
  if (isReaderMode) {
    return <ReaderPage />;
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
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={toggleSidebar}
        />
      )}

      {/* Mobile sidebar - only on small screens */}
      <div
        className={cn(
          "fixed left-0 top-0 h-full z-[60] md:hidden",
          "transform transition-transform duration-300",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Sidebar isMobile onClose={toggleSidebar} />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <AppTitlebar title="Lion Reader" onMenuClick={toggleSidebar} />

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          {renderPage()}
        </main>
      </div>
    </div>
  );
}

export default App;
