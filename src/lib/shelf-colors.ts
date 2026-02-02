import { useMemo } from "react";

// Generate a color from shelf name for consistent colors across sessions
export function getShelfColor(shelfId: string, shelfName: string): {
  bg: string;
  text: string;
  border: string;
  icon: string;
} {
  // Predefined color palette for shelves - professional, readable colors
  const colorPalette = [
    { bg: "#FEF3C7", text: "#92400E", border: "#FCD34D", icon: "#F59E0B" }, // Amber
    { bg: "#DBEAFE", text: "#1E40AF", border: "#93C5FD", icon: "#3B82F6" }, // Blue
    { bg: "#D1FAE5", text: "#065F46", border: "#6EE7B7", icon: "#10B981" }, // Emerald
    { bg: "#FCE7F3", text: "#9D174D", border: "#F9A8D4", icon: "#EC4899" }, // Pink
    { bg: "#E0E7FF", text: "#3730A3", border: "#A5B4FC", icon: "#6366F1" }, // Indigo
    { bg: "#FED7AA", text: "#9A3412", border: "#FDBA74", icon: "#F97316" }, // Orange
    { bg: "#E9D5FF", text: "#6B21A8", border: "#C4B5FD", icon: "#A855F7" }, // Purple
    { bg: "#CCFBF1", text: "#115E59", border: "#5EEAD4", icon: "#14B8A6" }, // Teal
    { bg: "#FECACA", text: "#991B1B", border: "#FCA5A5", icon: "#EF4444" }, // Red
    { bg: "#BBF7D0", text: "#166534", border: "#86EFAC", icon: "#22C55E" }, // Green
    { bg: "#DDD6FE", text: "#5B21B6", border: "#C4B5FD", icon: "#8B5CF6" }, // Violet
    { bg: "#CFFAFE", text: "#155E75", border: "#67E8F9", icon: "#06B6D4" }, // Cyan
    { bg: "#F5D0FE", text: "#86198F", border: "#E879F9", icon: "#D946EF" }, // Fuchsia
    { bg: "#FEE2E2", text: "#991B1B", border: "#FECACA", icon: "#EF4444" }, // Light Red
    { bg: "#FEF9C3", text: "#854D0E", border: "#FDE047", icon: "#EAB308" }, // Yellow
  ];

  // Use shelf name hash to consistently pick a color
  const hash = shelfName.split("").reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);

  const colorIndex = Math.abs(hash) % colorPalette.length;
  return colorPalette[colorIndex];
}

// Generate a compact shelf indicator (for dense shelf lists)
export function getShelfDotColor(shelfId: string, shelfName: string): string {
  const colors = [
    "bg-amber-500",
    "bg-blue-500",
    "bg-emerald-500",
    "bg-pink-500",
    "bg-indigo-500",
    "bg-orange-500",
    "bg-purple-500",
    "bg-teal-500",
    "bg-red-500",
    "bg-green-500",
    "bg-violet-500",
    "bg-cyan-500",
    "bg-fuchsia-500",
    "bg-yellow-500",
  ];

  const hash = shelfName.split("").reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);

  return colors[Math.abs(hash) % colors.length];
}

// Generate shelf initials (for avatars)
export function getShelfInitials(name: string): string {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Hook to get shelf color (memoized)
export function useShelfColor(shelfId: string, shelfName: string) {
  return useMemo(
    () => getShelfColor(shelfId, shelfName),
    [shelfId, shelfName]
  );
}
