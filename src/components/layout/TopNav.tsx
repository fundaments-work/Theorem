import { cn } from "@/lib/utils";
import { useUIStore } from "@/store";
import { Search, Menu, BarChart3 } from "lucide-react";

interface TopNavProps {
    onMenuClick?: () => void;
}

export function TopNav({ onMenuClick }: TopNavProps) {
    const { currentRoute, searchQuery, setSearchQuery, setRoute } = useUIStore();

    const getPageTitle = () => {
        switch (currentRoute) {
            case "library":
                return "Library";
            case "reader":
                return "Books";
            case "settings":
                return "Settings";
            case "statistics":
                return "Statistics";
            case "annotations":
                return "Highlights & Notes";
            case "bookmarks":
                return "Bookmarks";
            case "shelves":
                return "Shelves";
            case "bookDetails":
                return "Book Details";
            default:
                return "Theorem";
        }
    };

    return (
        <header className="flex items-center justify-between h-14 px-4 bg-[var(--color-surface)] border-b border-[var(--color-border)] ui-panel">
            {/* Left Section */}
            <div className="flex items-center gap-4">
                {/* Mobile menu button */}
                <button
                    onClick={onMenuClick}
                    className="lg:hidden ui-icon-btn w-9 h-9 rounded-lg text-[var(--color-text-secondary)]"
                >
                    <Menu className="w-5 h-5" />
                </button>

                {/* Page Title */}
                <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
                    {getPageTitle()}
                </h1>
            </div>

            {/* Center Section - Search */}
            <div className="flex-1 max-w-3xl mx-4">
                <div className="relative w-full">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                    <input
                        type="text"
                        placeholder="Search books, authors, or highlights..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className={cn(
                            "ui-input ui-input-search ui-input-with-leading-icon w-full pr-4 rounded-lg",
                            "min-h-[var(--control-height-md)]"
                        )}
                    />
                </div>
            </div>

            {/* Right Section */}
            <div className="flex items-center gap-2">
                {/* Statistics Button */}
                <button
                    onClick={() => setRoute("statistics")}
                    className={cn(
                        "ui-icon-btn w-9 h-9 rounded-lg",
                        currentRoute === "statistics"
                            ? "bg-[var(--color-accent)] text-[var(--color-accent-contrast)] border border-[var(--color-accent)]"
                            : "text-[var(--color-text-secondary)]"
                    )}
                    title="Statistics"
                >
                    <BarChart3 className="w-5 h-5" />
                </button>
            </div>
        </header>
    );
}
