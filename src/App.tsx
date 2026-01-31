import { useEffect } from "react";
import { AppTitlebar } from "@/components/AppTitlebar";
import { Sidebar, TopNav } from "@/components/layout";
import {
  LibraryPage,
  ReaderPage,
  ShelvesPage,
  AnnotationsPage,
  BookmarksPage,
  SettingsPage,
  ProfilePage,
} from "@/pages";
import { useUIStore, useSettingsStore } from "@/store";
import { cn } from "@/lib/utils";
import { initReaderStyles } from "@/lib/reader-styles";

function App() {
  const { currentRoute, sidebarOpen, toggleSidebar } = useUIStore();
  const { settings } = useSettingsStore();
  
  // Initialize reader styles on app load
  useEffect(() => {
    initReaderStyles(settings.readerSettings);
  }, []); // Only on mount - the store's onRehydrate will handle persisted settings

  // Check if we're in reader mode (full screen, no sidebar)
  const isReaderMode = currentRoute === "reader";

  // Render current page based on route
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
        return <ProfilePage />;
      case "profile":
        return <ProfilePage />;
      default:
        return <LibraryPage />;
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
          "fixed left-0 top-0 h-full z-50 md:hidden",
          "transform transition-transform duration-300",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Sidebar />
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
