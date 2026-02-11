import { useMemo } from "react";
import { SHELF_COLOR_PALETTE } from "@/lib/design-tokens";

// Generate a color from shelf name for consistent colors across sessions
export function getShelfColor(shelfId: string, shelfName: string): {
  bg: string;
  text: string;
  border: string;
  icon: string;
} {
  // Use shelf name hash to consistently pick a color
  const hash = shelfName.split("").reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);

  const colorIndex = Math.abs(hash) % SHELF_COLOR_PALETTE.length;
  const { bg, text, border, icon } = SHELF_COLOR_PALETTE[colorIndex];
  return { bg, text, border, icon };
}

// Generate a compact shelf indicator (for dense shelf lists)
export function getShelfDotColor(shelfId: string, shelfName: string): string {
  const hash = shelfName.split("").reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);

  return SHELF_COLOR_PALETTE[Math.abs(hash) % SHELF_COLOR_PALETTE.length].dotClass;
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
