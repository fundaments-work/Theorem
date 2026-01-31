# Agent Guidelines for Lion Reader

This is a Tauri-based desktop e-book reader application built with React, TypeScript, and Vite.

## Build Commands

```bash
# Development
npm run dev              # Start Vite dev server
npm run tauri dev        # Start Tauri dev mode (desktop app)

# Production Build
npm run build            # Build TypeScript + Vite for production
npm run tauri build      # Build Tauri desktop application

# Preview
npm run preview          # Preview production build locally
```

**Note:** There are currently no test or lint commands configured. Add tests using your preferred framework (Vitest recommended).

## Code Style Guidelines

### Project Structure
- **Frontend:** React + TypeScript + Vite in `/src`
- **Backend:** Rust + Tauri in `/src-tauri`
- **Entry:** `src/main.tsx` → `src/App.tsx`
- **Styling:** Tailwind CSS v4 with custom theme variables

### TypeScript Configuration
- Strict mode enabled with unused local/parameter checking
- Path alias: `@/` maps to `./src/`
- Target: ES2020, Module: ESNext
- JSX: `react-jsx` (automatic runtime)

### Naming Conventions
- **Components:** PascalCase (e.g., `ReaderPage`, `BookCard`)
- **Hooks:** camelCase with `use` prefix (e.g., `useDocumentReader`)
- **Types/Interfaces:** PascalCase (e.g., `Book`, `DocLocation`)
- **Constants:** UPPER_SNAKE_CASE for true constants
- **Files:** Match default export name (PascalCase for components)
- **Zustand stores:** camelCase with `use` prefix + `Store` suffix

### Imports (Order)
1. React imports
2. Third-party libraries (lucide-react, zustand, etc.)
3. Absolute imports with `@/` alias
4. Relative imports
5. Type-only imports

Example:
```typescript
import { useState, useCallback } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLibraryStore } from '@/store';
import type { Book } from '@/types';
```

### Formatting
- **Indentation:** 4 spaces (no tabs)
- **Quotes:** Double quotes for strings, single quotes for JSX attributes when needed
- **Trailing commas:** Required in multi-line objects/arrays
- **Semicolons:** Required
- **Line length:** No strict limit, keep readable

### Component Patterns
- Use function declarations for components, not arrow functions
- Add JSDoc header describing the component's purpose
- Destructure props in function parameters
- Use `cn()` utility from `@/lib/utils` for conditional classes
- Prefer named exports, avoid `export default`

```typescript
/**
 * Component description
 */
export function ComponentName({ prop1, prop2 }: ComponentProps) {
    return <div className={cn("base", conditional && "conditional")} />;
}
```

### State Management (Zustand)
- Store files in `src/store/index.ts`
- Use separate stores for different domains (UI, Library, Settings)
- Enable persistence with `persist` middleware for data that should survive reloads
- Use selectors to prevent unnecessary re-renders

### Styling (Tailwind CSS v4)
- Use CSS variables from `@theme` in `src/index.css`
- Pattern: `bg-[var(--color-surface)]`, `text-[var(--color-text-primary)]`
- Custom color scheme: monochrome base with single accent
- Animation classes: `animate-fade-in`

### Error Handling
- Use try/catch for async operations
- Set error state through Zustand stores
- Console.error with descriptive messages
- Graceful fallbacks for missing data

### Performance Guidelines
- Use `useCallback` for event handlers passed to children
- Use `useMemo` for expensive computations
- Use `useRef` for stable references that don't trigger re-renders
- Store callbacks in refs to avoid dependency array issues
- Batch state updates where possible
- Lazy load heavy components with dynamic imports

### File Organization
- **Components:** Group by feature (e.g., `reader/`, `layout/`, `ui/`)
- **Barrel exports:** Each folder has `index.ts` exporting public API
- **Types:** Centralized in `src/types/index.ts`
- **Utilities:** Shared helpers in `src/lib/`

### Type Safety
- Export types from `src/types/index.ts`
- Use strict TypeScript checking
- Define interfaces for all data structures
- Use type assertions sparingly

### Git
- No pre-commit hooks configured
- Follow conventional commit messages (feat:, fix:, refactor:, etc.)

### Rust/Tauri Backend
- Located in `src-tauri/`
- Standard Rust formatting (cargo fmt)
- Use serde for JSON serialization
- Keep commands simple and focused
