# Module Index

Generated from workspace manifests. Use this file as the first lookup point for AI-assisted changes.

| Package | Path | Public Entry | Internal Dependencies | Purpose |
| --- | --- | --- | --- | --- |
| `@theorem/core` | `packages/core` | `packages/core/src/index.ts` | _none_ | Shared workspace package. |
| `@theorem/feature-feeds` | `packages/features/feeds` | `packages/features/feeds/src/index.ts` | `@theorem/core`, `@theorem/ui` | Feature package. |
| `@theorem/feature-learning` | `packages/features/learning` | `packages/features/learning/src/index.ts` | `@theorem/core`, `@theorem/ui` | Feature package. |
| `@theorem/feature-library` | `packages/features/library` | `packages/features/library/src/index.ts` | `@theorem/core`, `@theorem/ui` | Feature package. |
| `@theorem/feature-reader` | `packages/features/reader` | `packages/features/reader/src/index.ts` | `@theorem/core`, `@theorem/feature-learning`, `@theorem/ui` | Feature package. |
| `@theorem/feature-settings` | `packages/features/settings` | `packages/features/settings/src/index.ts` | `@theorem/core`, `@theorem/ui` | Feature package. |
| `@theorem/feature-statistics` | `packages/features/statistics` | `packages/features/statistics/src/index.ts` | `@theorem/core`, `@theorem/ui` | Feature package. |
| `@theorem/feature-vocabulary` | `packages/features/vocabulary` | `packages/features/vocabulary/src/index.ts` | `@theorem/core`, `@theorem/ui` | Feature package. |
| `@theorem/ui` | `packages/ui` | `packages/ui/src/index.ts` | `@theorem/core` | Shared workspace package. |
| `@theorem/web` | `apps/web` | `n/a` | `@theorem/core`, `@theorem/feature-feeds`, `@theorem/feature-learning`, `@theorem/feature-library`, `@theorem/feature-reader`, `@theorem/feature-settings`, `@theorem/feature-statistics`, `@theorem/feature-vocabulary`, `@theorem/ui` | Application package. |

## Usage Rules

1. Edit one package at a time whenever possible.
2. Import cross-package symbols only through package entry points.
3. Run package-level checks before full app checks.
4. Update this index after adding/removing workspace packages.

