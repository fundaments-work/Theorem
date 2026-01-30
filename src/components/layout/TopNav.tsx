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
                return "Lion Reader";
        }
    };

    return (
        <header className="flex items-center justify-between h-14 px-4 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
            {/* Left Section */}
            <div className="flex items-center gap-4">
                {/* Mobile menu button */}
                <button
                    onClick={onMenuClick}
                    className="lg:hidden p-2 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-border-subtle)]"
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
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                    <input
                        type="text"
                        placeholder="Search books, authors, or highlights..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className={cn(
                            "w-full pl-10 pr-4 py-2 rounded-lg",
                            "bg-[var(--color-background)] border border-[var(--color-border)]",
                            "text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]",
                            "focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-light)]",
                            "transition-colors duration-200"
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
                        "p-2 rounded-lg transition-colors",
                        currentRoute === "statistics"
                            ? "bg-[var(--color-accent)] text-white"
                            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]"
                    )}
                    title="Statistics"
                >
                    <BarChart3 className="w-5 h-5" />
                </button>
            </div>
        </header>
    );
}
