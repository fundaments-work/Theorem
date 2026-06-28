# Theorem — Design Language

v1.0 · fundaments.work · 2026

## Concept

The mark is a constructed turnstile (⊢) — the logical notation for "derives" or "therefore." It is never the literal Unicode ⊢ character; it's always built from two rectangles per the anatomy spec below, so it renders identically across every platform, weight, and rasterizer.

A theorem is a statement derived from axioms through valid steps. The symbol that proof theory uses for "derives" is the same symbol that names the product. The mark isn't decorative — it's the logo and the thesis in one shape.

## Mark anatomy

| Property | Value |
|---|---|
| Vertical bar width | 12.5% of mark height |
| Horizontal bar (midbar) weight | same as vertical bar |
| Midbar position | 44% from top — **not centered**. Centering makes it read as a capital F instead of a logical symbol. |
| Midbar length | 62% of total mark width, extending right from the vertical bar |
| Minimum size | 14px tall — below this the midbar gap collapses |
| Clear space | 1× mark height on all sides, minimum |

### Reference sizes

| Context | Size |
|---|---|
| Display | 48px |
| UI (toolbar, nav) | 32px |
| Inline (buttons, lists) | 20px |
| Minimum (favicon, dense UI) | 14px |

### Construction (CSS)

```css
.mark {
  position: relative;
  width: 32px;
  height: 32px;
}
.mark::before,
.mark::after {
  content: "";
  position: absolute;
  left: 0;
  background: var(--ink);
}
.mark::before { width: 4px;  height: 32px; top: 0; }   /* vertical bar */
.mark::after  { width: 20px; height: 4px;  top: 14px; } /* midbar, 44% from top */
```

### Never

- Never use the literal Unicode ⊢ (U+22A2) character — always the constructed shape, so weight and proportion stay under control.
- Never rotate, skew, or outline the mark.
- Never recolor the umbrella mark. Product-level tinting is limited to the accent rules below.

## Lockups

- **Horizontal** — mark + "Theorem" (DM Sans 300) + "fundaments.work" credit beneath, in DM Mono, smaller and muted.
- **Stacked** — mark above, wordmark + credit below, left-aligned.
- **Reversed** — same lockup with ink/paper swapped, for dark surfaces (splash screen, dock icon background).

"Theorem" is always weight 300. Never bold, never italic — except for the rare editorial blockquote moment in long-form body copy.

## Color

### Neutral scale

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#0a0a0a` | primary text, mark fill |
| `--ink-60` | `#666666` | secondary text, captions |
| `--ink-30` | `#b8b8b8` | tertiary text, disabled states |
| `--ink-10` | `#e8e8e8` | borders, dividers |
| `--paper-2` | `#f2f1ee` | secondary surface, hover background |
| `--paper` | `#fafaf8` | primary background |

### Accent — reading state only

| Token | Hex | Use |
|---|---|---|
| `--stone` | `#c8b89a` | reading-progress fill, highlights, current-chapter marker |

The accent is reserved **exclusively** for reading-state feedback. It never appears in navigation, buttons, or structural chrome. If everything is accented, nothing signals state.

## Typography

Font stack: **DM Sans** (UI, body) + **DM Mono** (metadata, labels, code). Two weights only — 300 and 400 in each family. No 500, 600, or 700; weight contrast comes from size and color, never boldness.

| Style | Font / weight | Size | Letter-spacing | Use |
|---|---|---|---|---|
| Display | DM Sans 300 | 32px | −3% | Marketing headlines |
| Headline | DM Sans 300 | 20px | −2% | Section headers |
| Body | DM Sans 400 | 14px | −1% | Reading UI, descriptions |
| Caption | DM Sans 300 | 12px | 0% | Secondary descriptions |
| Label | DM Mono 400 | 11px | +8%, uppercase | Format tags, metadata |
| Micro | DM Mono 300 | 10px | +4% | Version strings, timestamps |

## Spacing

Base unit: **4px**. All spacing is a multiple of 4 — `4, 8, 12, 16, 24, 32, 48, 64, 96`. No arbitrary values outside this scale.

- Component-internal gaps: 8–16px
- Component-to-component: 16–24px
- Section gaps: 64px
- Page margins: 48px desktop, 24px mobile

## Components

### Buttons

```css
.btn-primary { background: var(--ink); color: var(--paper); border: none; padding: 8px 16px; border-radius: 0; }
.btn-ghost   { background: transparent; color: var(--ink); border: 0.5px solid var(--ink); border-radius: 0; }
.btn-muted   { background: var(--paper-2); color: var(--ink-60); border: none; border-radius: 0; }
```

No rounded corners anywhere, on any element.

### Reading progress

```css
.progress-track { height: 2px; background: var(--ink-10); width: 100%; }
.progress-fill  { height: 2px; background: var(--stone); }
```

This is the only place the accent color appears in the interface.

### Tags

DM Mono, 10px. Used for format (`epub` / `pdf`), status (`reading` / `finished`), and version metadata. Only the `reading` status tag may use the stone accent as an outline; all others stay neutral.

### Library list item

Cover placeholder (monochrome rect with monogram initials if no cover art) + title (DM Sans 400) + author (DM Mono, muted, uppercase) + inline progress bar + status tag.

## Motion

| | |
|---|---|
| Durations | 80ms micro · 160ms standard · 240ms page · 400ms reveal — never exceed 400ms |
| Easing | Enter `cubic-bezier(.2,0,0,1)` · Exit `cubic-bezier(.4,0,1,1)` — no bounce, no spring |
| Principle | Motion confirms a reading-state change (page turned, book opened, progress updated). It never decorates. |

## Icon contexts

| Context | Spec |
|---|---|
| Favicon | 32×32, mark only, ink on paper |
| App / dock icon | 512×512 master, scaled down — mark only |
| Social avatar | mark centered in circle crop, reversed (paper mark on ink) |
| OG / share banner | reversed lockup — "Theorem" + fundaments.work credit |

## Usage rules

**Do**
- Use the mark alone wherever space is tight (favicon, dock icon, tab)
- Use DM Mono for every piece of metadata — page count, file format, file size, progress percentage
- Reserve the stone accent strictly for reading-state feedback
- Keep "Theorem" at weight 300 everywhere
- Maintain 1× mark-height clear space around the mark

**Don't**
- Rotate, skew, or outline the mark
- Introduce a second accent color
- Bold the wordmark for emphasis — use size, not weight
- Place the mark on a photographic or patterned background
- Round any corner, anywhere

---

v1.0 · fundaments.work · 2026