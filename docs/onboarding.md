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

The `OnboardingFlow` component (`src/features/onboarding/OnboardingFlow.tsx`) presents a sequence of screens:

1. **Welcome** — "Welcome to Theorem." Brief description of what it is.
2. **Import books** — Prompts user to import books (opens file dialog on click).
3. **Reader demo** — Shows annotated screenshot of the reader.
4. **Sync intro** — If Tauri, introduces P2P sync concept.
5. **Complete** — "You're ready."

The flow is sequential with "Next" / "Back" buttons. Progress is shown as dots. On completion, `settings.hasCompletedOnboarding` is set to `true`, which causes the next render to skip the onboarding and show the main app.
