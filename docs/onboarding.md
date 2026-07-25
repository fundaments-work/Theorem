# Onboarding

## Flow

The onboarding flow runs once per user (persisted via `settings.hasCompletedOnboarding`). It's rendered before the main app UI:

```
App starts
  │
  ├─ storesHydrated? No → spinner
  │
  ├─ hasCompletedOnboarding? No → OnboardingFlow
  │
  └─ hasCompletedOnboarding? Yes → main App UI
```

## Screens

The `OnboardingFlow` component (`src/features/onboarding/OnboardingFlow.tsx`) presents 5 steps with inline SVG illustrations:

1. **Welcome** — "Own your reading data. Forever." — Local-first, no cloud account, no subscription.
2. **Read Anything** — All formats (PDF, EPUB, MOBI, AZW, FB2, CBZ/CBR, RSS) in one reader.
3. **Highlight and Annotate** — Multiple highlight colors, notes, bookmarks, dictionary lookups, TTS immersion reading, speed-reading mode.
4. **Organize Your Library** — Shelves, format/status/favorites filters, reading statistics, daily goals.
5. **Sync Across Devices** — P2P LAN sync for reading progress, highlights, and books. Export to Markdown vaults.

The flow is sequential with "Next" / "Back" buttons. A "Skip" button is in the top-right. Progress is shown as clickable dots. On completion, `settings.hasCompletedOnboarding` and `localStorage.theorem-onboarding-complete` are set to `true`, which causes the next render to skip onboarding and show the main app.
