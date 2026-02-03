# Agent Guidelines for Lion Reader

Tauri-based desktop e-book reader built with React, TypeScript, Vite, and Tailwind CSS v4. Uses Zustand for state management and Foliate-js for EPUB rendering.

## Build Commands

```bash
# Frontend Development
npm run dev              # Start Vite dev server (web mode)
npm run build            # Build TypeScript + Vite for production
cd src-tauri && cargo build --release  # Build Rust backend only

# Full Desktop App
npm run tauri dev        # Start Tauri dev mode (desktop app with hot reload)
npm run tauri build      # Build complete Tauri desktop application

# Preview
npm run preview          # Preview production build locally
```

**Testing:** No test framework configured yet. Add Vitest for unit tests and Playwright for E2E.

## Project Structure

```
src/                     # React frontend
├── components/          # React components by feature
│   ├── layout/          # App layout (Sidebar, TopNav)
│   ├── reader/          # Reader UI components
│   └── ui/              # Shared UI primitives
├── pages/               # Page-level components
├── store/               # Zustand stores (UI, Library, Settings)
├── types/               # TypeScript type definitions
├── lib/                 # Utility functions and helpers
├── hooks/               # Custom React hooks
├── engines/             # Document rendering engines
└── foliate/            # Foliate-js integration

src-tauri/               # Rust backend
├── src/
│   ├── lib.rs          # Tauri command handlers
│   └── main.rs         # Application entry point
├── Cargo.toml          # Rust dependencies
└── tauri.conf.json     # Tauri configuration
```

## Code Style Guidelines

### TypeScript Configuration
- Strict mode enabled with ES2020 target
- Path alias: `@/` maps to `./src/`
- JSX: `react-jsx` (automatic runtime)
- Module: ESNext with bundler resolution

### Naming Conventions
- **Components:** PascalCase (e.g., `ReaderToolbar`, `BookCard`)
- **Hooks:** camelCase with `use` prefix (e.g., `useDocumentReader`)
- **Types/Interfaces:** PascalCase (e.g., `Book`, `DocLocation`)
- **Constants:** UPPER_SNAKE_CASE
- **Zustand stores:** camelCase with `use` prefix + `Store` suffix
- **Files:** Match default export name

### Imports (Strict Order)
1. React imports
2. Third-party libraries (lucide-react, zustand, etc.)
3. Absolute imports with `@/` alias
4. Relative imports
5. Type-only imports with `type` keyword

Example:
```typescript
import { useState, useCallback } from "react";
import { Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLibraryStore } from "@/store";
import type { Book, DocLocation } from "@/types";
```

### Formatting
- **Indentation:** 4 spaces (no tabs)
- **Quotes:** Double quotes for strings
- **Trailing commas:** Required in multi-line objects/arrays
- **Semicolons:** Required
- **Line length:** ~100 chars max, keep readable

### Component Patterns
- Use function declarations, not arrow functions
- Add JSDoc header describing purpose
- Destructure props in function parameters
- Use `cn()` utility for conditional Tailwind classes
- Prefer named exports

```typescript
/**
 * Component description here
 */
export function ComponentName({ prop1, prop2 }: ComponentProps) {
    return <div className={cn("base", conditional && "conditional")} />;
}
```

### Styling (Tailwind CSS v4)
- **CSS Variables:** Use theme variables from `@theme` in `src/index.css`
- **Pattern:** `bg-[var(--color-surface)]`, `text-[var(--color-text-primary)]`
- **Color scheme:** Monochrome base (#1a1a1a) with single accent
- **Themes:** Light, Sepia, Dark themes via CSS classes (`.theme-light`, `.theme-dark`)
- **Animation:** Use `animate-fade-in` for transitions
- **Reader styling:** Uses separate CSS variables (`--reader-bg`, `--reader-fg`)

### State Management (Zustand)
- Store files in `src/store/index.ts`
- Use separate stores per domain (UI, Library, Settings)
- Enable persistence with `persist` middleware for data that should survive reloads
- Use selectors to prevent unnecessary re-renders

### Error Handling
- Use try/catch for async operations
- Set error state through Zustand stores
- Console.error with descriptive messages
- Graceful fallbacks for missing data

### Performance Guidelines
- Use `useCallback` for event handlers passed to children
- Use `useMemo` for expensive computations
- Store callbacks in refs to avoid dependency array issues
- Batch state updates where possible
- Lazy load heavy components with dynamic imports

### File Organization
- **Components:** Group by feature (reader/, layout/, ui/)
- **Barrel exports:** Each folder has `index.ts` exporting public API
- **Types:** Centralized in `src/types/index.ts`
- **Utilities:** Shared helpers in `src/lib/`

### Type Safety
- Define interfaces for all data structures in `src/types/index.ts`
- Use strict TypeScript checking
- Use type assertions sparingly

## Key Libraries

- **State:** Zustand with persist middleware
- **Icons:** Lucide React
- **Styling:** Tailwind CSS v4 with CSS variables
- **Routing:** React Router DOM (memory router for desktop)
- **E-book Rendering:** Foliate-js (EPUB), PDFium (PDF - see PDFIUM_INTEGRATION_GUIDE.md)
- **Storage:** IndexedDB via idb-keyval
- **Date:** date-fns

## Rust/Tauri Backend

Located in `src-tauri/`:
- Standard Rust formatting (`cargo fmt`)
- Use serde for JSON serialization
- Keep commands simple and focused
- Tauri plugins used: fs, dialog, os, opener

## Git

- No pre-commit hooks configured
- Follow conventional commit messages: `feat:`, `fix:`, `refactor:`, `docs:`

## Environment Notes

- Development uses Vite dev server (web mode)
- Tauri dev mode runs full desktop app with Rust backend
- Some features (file import) require Tauri and won't work in web-only mode
- Check `isTauri()` from `@/lib/env` before calling Tauri APIs
