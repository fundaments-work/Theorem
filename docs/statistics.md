# Statistics

## What's Tracked

Reading statistics are stored in `settingsStore.stats` (persisted alongside settings):

| Stat | How It's Calculated |
|------|---------------------|
| Total reading time | Sum of per-session reading durations |
| Books completed | Books where `progress >= 1.0` |
| Current streak | Consecutive days with reading time > 0 |
| Longest streak | Max consecutive days ever recorded |
| Daily goal progress | Today's reading minutes vs `dailyGoal` |
| Yearly book goal | Books completed this year vs `yearlyBookGoal` |
| Average reading speed | Total words read / total hours |
| Daily activity | Per-day reading minutes for heatmap |

## How Reading Time Is Tracked

The reader tracks active reading time (not wall-clock time). The timer runs only when:
- The reader is the active tab/window
- User is interacting (scrolling, clicking, turning pages)
- The document is visible (not backgrounded)

After 30 seconds of inactivity, the timer pauses. It resumes on the next interaction.

Time is reported as `readingTime: number` (milliseconds) on the `Book` object and aggregated into `stats.totalReadingTime`.

## Daily Activity Heatmap

The `dailyActivity` array stores per-day reading minutes. Each entry is `{ date: string, minutes: number, booksRead: string[] }`. The Statistics page renders this as a GitHub-style heatmap grid.

For performance, only the last 365 days are stored. Older entries are pruned on save.

## Goals

Two goals are user-configurable in Settings:
- **Daily minutes**: Target minutes per day (default: 30)
- **Yearly books**: Target books per year (default: 24)

Progress bars show completion percentage for both.

## Sharing Stats

The `ShareCardModal` generates a shareable image of the user's reading stats using `html-to-image` (dynamically imported). The image can be:
- Downloaded as PNG via `saveImageViaTauri` (desktop) or browser download (web)
- Shared via Web Share API (mobile browsers)

The share card renders a separate React component (`ShareCard`) into a temporary DOM node using `react-dom/client`'s `createRoot`, then captures it with `html-to-image`. This avoids polluting the main UI state.
