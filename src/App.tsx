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
import { useUIStore } from "@/store";
import { cn } from "@/lib/utils";

function App() {
  const { currentRoute, sidebarOpen, toggleSidebar } = useUIStore();

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
      {/* Sidebar - Hidden on mobile */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay - only on mobile screens */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={toggleSidebar}
        />
      )}

      {/* Mobile sidebar - only on mobile screens */}
      <div
        className={cn(
          "fixed left-0 top-0 h-full z-50 lg:hidden",
          "transform transition-transform duration-300",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Sidebar />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopNav onMenuClick={toggleSidebar} />

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          {renderPage()}
        </main>
      </div>
    </div>
  );
}

export default App;
