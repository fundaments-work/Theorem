# @theorem/ui

Shared workspace package.

## Module

- Path: `/packages/ui`
- Version: `0.1.0`
- Public entry: `/packages/ui/src/index.ts`

## Dependencies

**Internal packages**
- `@theorem/core`

**External packages**
- `clsx`
- `lucide-react`
- `react`
- `react-dom`
- `tailwind-merge`
- `zustand`

## API Reference

### Functions

### Function `AppTitlebar`

```ts
AppTitlebar({ title, onMenuClick, className, }: AppTitlebarProps): JSX.Element
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `AppTitlebarProps` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `className` | `string | undefined` | yes |
| `onMenuClick` | `(() => void) | undefined` | yes |
| `title` | `string` | no |

- Returns: `JSX.Element`

### Function `Backdrop`

```ts
Backdrop({ visible, onClick, className, blur }: BackdropProps): JSX.Element | null
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `BackdropProps` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `blur` | `boolean | undefined` | yes |
| `className` | `string | undefined` | yes |
| `onClick` | `(() => void) | undefined` | yes |
| `visible` | `boolean` | no |

- Returns: `JSX.Element | null`

### Function `ContextMenu`

Context Menu Component using React Portal Renders outside the main DOM tree to avoid z-index conflicts with titlebar

```ts
ContextMenu({ items, children, className }: ContextMenuProps): JSX.Element
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `ContextMenuProps` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `children` | `React.ReactNode` | no |
| `className` | `string | undefined` | yes |
| `items` | `ContextMenuItem[]` | no |

- Returns: `JSX.Element`

### Function `Dropdown`

Custom Dropdown Component Replaces native <select> with styled dropdown matching the app's design system

```ts
Dropdown<T extends string = string>({ options, value, defaultValue, onChange, placeholder, disabled, size, variant, className, dropdownClassName, align, showCheckmark, }: DropdownProps<T>): JSX.Element
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `DropdownProps<T>` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `align` | `"left" | "right" | undefined` | yes |
| `className` | `string | undefined` | yes |
| `defaultValue` | `T | undefined` | yes |
| `disabled` | `boolean | undefined` | yes |
| `dropdownClassName` | `string | undefined` | yes |
| `onChange` | `((value: T) => void) | undefined` | yes |
| `options` | `DropdownOption<T>[]` | no |
| `placeholder` | `string | undefined` | yes |
| `showCheckmark` | `boolean | undefined` | yes |
| `size` | `"sm" | "md" | "lg" | undefined` | yes |
| `value` | `T | undefined` | yes |
| `variant` | `"default" | "filled" | "outlined" | undefined` | yes |

- Returns: `JSX.Element`

### Function `EditNoteModal`

```ts
EditNoteModal({ isOpen, content, onClose, onSave }: EditNoteModalProps): JSX.Element
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `EditNoteModalProps` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `content` | `string` | no |
| `isOpen` | `boolean` | no |
| `onClose` | `() => void` | no |
| `onSave` | `(content: string) => void` | no |

- Returns: `JSX.Element`

### Function `FloatingPanel`

```ts
FloatingPanel({ visible, children, className, anchor, }: FloatingPanelProps): JSX.Element
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `FloatingPanelProps` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `anchor` | `"top-left" | "top-right" | undefined` | yes |
| `children` | `ReactNode` | no |
| `className` | `string | undefined` | yes |
| `visible` | `boolean` | no |

- Returns: `JSX.Element`

### Function `Modal`

Reusable Modal Component using React Portal Renders outside the main DOM tree for proper z-index stacking

```ts
Modal({ isOpen, onClose, children, className, size, showCloseButton, }: ModalProps): ReactPortal | null
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `ModalProps` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `children` | `React.ReactNode` | no |
| `className` | `string | undefined` | yes |
| `isOpen` | `boolean` | no |
| `onClose` | `() => void` | no |
| `showCloseButton` | `boolean | undefined` | yes |
| `size` | `"sm" | "md" | "lg" | "xl" | "fullscreen" | undefined` | yes |

- Returns: `ReactPortal | null`

### Function `ModalBody`

```ts
ModalBody({ children, className }: { children: React.ReactNode; className?: string; }): JSX.Element
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `{ children: React.ReactNode; className?: string; }` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `children` | `React.ReactNode` | no |
| `className` | `string | undefined` | yes |

- Returns: `JSX.Element`

### Function `ModalFooter`

```ts
ModalFooter({ children, className }: ModalFooterProps): JSX.Element
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `ModalFooterProps` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `children` | `React.ReactNode` | no |
| `className` | `string | undefined` | yes |

- Returns: `JSX.Element`

### Function `ModalHeader`

```ts
ModalHeader({ title, onClose, showCloseButton }: ModalHeaderProps): JSX.Element
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `ModalHeaderProps` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `onClose` | `(() => void) | undefined` | yes |
| `showCloseButton` | `boolean | undefined` | yes |
| `title` | `string` | no |

- Returns: `JSX.Element`

### Function `Panel`

```ts
Panel({ visible, children, position, width, className, header, }: PanelProps): JSX.Element
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `PanelProps` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `children` | `ReactNode` | no |
| `className` | `string | undefined` | yes |
| `header` | `ReactNode` | yes |
| `position` | `PanelPosition | undefined` | yes |
| `visible` | `boolean` | no |
| `width` | `string | undefined` | yes |

- Returns: `JSX.Element`

### Function `ShelfModal`

```ts
ShelfModal({ isOpen, shelf, onClose, onSave }: ShelfModalProps): JSX.Element
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `ShelfModalProps` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `isOpen` | `boolean` | no |
| `onClose` | `() => void` | no |
| `onSave` | `(name: string, description: string) => void` | no |
| `shelf` | `{ id: string; name: string; description?: string; } | undefined` | yes |

- Returns: `JSX.Element`

### Function `Sidebar`

```ts
Sidebar({ isMobile, onClose }: SidebarProps): JSX.Element
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `SidebarProps` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `isMobile` | `boolean | undefined` | yes |
| `onClose` | `(() => void) | undefined` | yes |

- Returns: `JSX.Element`

### Types and Interfaces

### Interface `ContextMenuItem`

- Type: `ContextMenuItem`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `danger` | `boolean | undefined` | yes |
| `disabled` | `boolean | undefined` | yes |
| `icon` | `React.ReactNode` | yes |
| `id` | `string` | no |
| `label` | `string` | no |
| `onClick` | `(() => void) | undefined` | yes |
| `separator` | `boolean | undefined` | yes |
| `shortcut` | `string | undefined` | yes |

### Interface `DropdownOption`

- Type: `DropdownOption<T>`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `disabled` | `boolean | undefined` | yes |
| `label` | `string` | no |
| `value` | `T` | no |

### Interface `DropdownProps`

- Type: `DropdownProps<T>`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `align` | `"left" | "right" | undefined` | yes |
| `className` | `string | undefined` | yes |
| `defaultValue` | `T | undefined` | yes |
| `disabled` | `boolean | undefined` | yes |
| `dropdownClassName` | `string | undefined` | yes |
| `onChange` | `((value: T) => void) | undefined` | yes |
| `options` | `DropdownOption<T>[]` | no |
| `placeholder` | `string | undefined` | yes |
| `showCheckmark` | `boolean | undefined` | yes |
| `size` | `"sm" | "md" | "lg" | undefined` | yes |
| `value` | `T | undefined` | yes |
| `variant` | `"default" | "filled" | "outlined" | undefined` | yes |

### Class `ErrorBoundary`

Error Boundary component to catch and display runtime errors instead of showing a blank white screen

- Type: `ErrorBoundary`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `componentDidCatch` | `(error: Error, errorInfo: React.ErrorInfo) => void` | no |
| `render` | `() => string | number | bigint | boolean | JSX.Element | Iterable<ReactNode> | Promise<AwaitedReactNode> | null | undefined` | no |

### Interface `ModalProps`

- Type: `ModalProps`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `children` | `React.ReactNode` | no |
| `className` | `string | undefined` | yes |
| `isOpen` | `boolean` | no |
| `onClose` | `() => void` | no |
| `showCloseButton` | `boolean | undefined` | yes |
| `size` | `"sm" | "md" | "lg" | "xl" | "fullscreen" | undefined` | yes |

### Type `PanelPosition`

- Type: `PanelPosition`

**Fields**

_No object fields detected._

## Validation

- `pnpm --filter @theorem/ui typecheck`
- `pnpm build`

_Generated by `scripts/generate-module-docs.mjs`._

