# Lion Reader - Developer Guide for Agentic Coding

## Project Overview
Lion Reader is a cross-platform eBook reader built with Tauri + React + TypeScript. It supports EPUB, PDF, and other document formats with a focus on performance and reading experience.

## Development Commands

### Core Commands
- **Development**: `npm run dev` - Start Vite dev server on port 1420
- **Build**: `npm run build` - TypeScript compilation + Vite build
- **Preview**: `npm run preview` - Preview production build
- **Tauri Dev**: `npm run tauri dev` - Run app in development mode
- **Tauri Build**: `npm run tauri build` - Build production native app

### Type Checking & Linting
- **TypeScript**: `tsc --noEmit` - Type checking without emitting files
- **ESLint**: `npx eslint src/` (config in `src/lib/foliate-js/eslint.config.js`)

### Testing
No test framework currently configured. When adding tests, update this section.

## Architecture & Project Structure

```
src/
├── components/          # React components
│   ├── layout/         # Layout components (Sidebar, TopNav)
│   └── reader/         # Reader-specific components
├── engines/            # Document rendering engines (EPUB, PDF)
├── hooks/              # Custom React hooks
├── lib/                # Utility libraries
├── pages/              # Page components
├── store/              # Zustand state management
└── types/              # TypeScript type definitions
```

## Code Style Guidelines

### TypeScript Configuration
- **Strict mode**: Enabled with `noUnusedLocals`, `noUnusedParameters`
- **Module system**: ESNext with bundler resolution
- **JSX**: `react-jsx` transform
- **Path aliases**: `@/*` maps to `./src/*`

### Import Conventions
```typescript
// External dependencies first
import { useState, useCallback } from 'react'
import { clsx } from 'clsx'

// Internal imports using @ alias
import { cn } from '@/lib/utils'
import { useDocumentReader } from '@/hooks'
import type { DocLocation, Book } from '@/types'
```

### Code Formatting (ESLint Rules)
- **Semicolons**: Disabled (no semicolons)
- **Indentation**: 4 spaces
- **Quotes**: Single quotes
- **Comma dangle**: Always multiline
- **Console**: Allow only `debug`, `warn`, `error`, `assert`

### Naming Conventions
- **Components**: PascalCase (e.g., `ReaderViewport`, `BookInfoPopover`)
- **Functions/Hooks**: camelCase (e.g., `useDocumentReader`, `formatReadingTime`)
- **Constants**: UPPER_SNAKE_CASE for exports, camelCase for internal
- **Files**: PascalCase for components, camelCase for utilities
- **Types/Interfaces**: PascalCase with descriptive names

### Component Patterns
- **Forward refs**: Use `forwardRef` for components needing imperative handles
- **Props interface**: Define props interfaces separately
- **Default props**: Use default parameters instead of defaultProps
- **Display name**: Always set `Component.displayName` for forwardRef components

### Styling Conventions
- **CSS Framework**: Tailwind CSS v4 with custom theme
- **Utility function**: Use `cn()` from `@/lib/utils` for class merging
- **Design system**: Monochrome-based with subtle colors
- **Color palette**: Background (`#ffffff`), Text primary (`#1a1a1a`), Accent (`#000000`)
- **Responsive**: Mobile-first approach with `lg:` breakpoints

### State Management
- **Primary store**: Zustand with persistence middleware
- **Store pattern**: Separate stores by concern (UI, Library, Settings)
- **Persistence**: Use `persist` middleware with `partialize` for selective persistence

### Error Handling
- **Components**: Use `onError` props for error callbacks
- **Async operations**: Try-catch with proper error typing
- **User feedback**: Display error messages via UI state
- **Logging**: Use `console.debug`, `warn`, `error`, `assert` only

### Performance Guidelines
- **Memoization**: Use `useMemo` for expensive computations, `useCallback` for stable references
- **Virtual scrolling**: Enabled for long documents
- **Prefetching**: Configurable prefetch distance (1-3 sections)
- **Re-renders**: Be mindful in reader components

### File Organization
- **Barrels**: Use `index.ts` files for clean exports from directories
- **Types**: Centralized in `src/types/index.ts`
- **Utils**: Shared utilities in `src/lib/utils.ts`

## Common Patterns

### Custom Hook Pattern
```typescript
export function useDocumentReader(options: UseDocumentReaderOptions = {}) {
    const [state, setState] = useState()
    const callback = useCallback(() => {
        // Implementation
    }, [])
    return { state, callback }
}
```

### Component with Forward Ref Pattern
```typescript
export interface ComponentHandle {
    method: () => void
}

export const Component = forwardRef<ComponentHandle, ComponentProps>(
    (props, ref) => {
        useImperativeHandle(ref, () => ({
            method: () => {}
        }))
        return <div>{props.children}</div>
    }
)
Component.displayName = 'Component'
```

### Zustand Store Pattern
```typescript
export const useStore = create<State>()(
    persist(
        (set, get) => ({
            // State
            // Actions
        }),
        { name: 'store-name', partialize: (state) => ({ ... }) }
    )
)
```

## Development Environment
- **Node modules**: Standard npm setup
- **Dev server**: Vite on port 1420 (fixed for Tauri)
- **Hot reload**: Enabled with WebSocket on port 1421
- **File watching**: Ignores `src-tauri/` directory

## Notes for AI Agents
- **Tauri integration**: Many file operations use Tauri APIs (@tauri-apps/*)
- **File paths**: Use `@` alias for internal imports consistently
- **Type safety**: All interfaces are strictly typed - don't bypass types
- **Performance**: Reader components are optimized - be mindful of re-renders
- **CSS variables**: Use the defined CSS custom properties for consistency
- **No semicolons**: Follow the project's semicolon-free style
