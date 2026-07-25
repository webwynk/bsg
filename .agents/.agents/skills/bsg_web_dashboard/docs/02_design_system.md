# DESIGN SYSTEM (UI/UX)

## 1. Design Philosophy

The dashboard follows a modern, professional SaaS (Software as a Service) aesthetic. It must contrast with the colorful, vibrant consumer-facing app by being strictly data-focused, trustworthy, and minimal.

* **Mobile-First:** Designed at 375px width first, then scaled up. Must feel like a native app on mobile browsers — no pinch-zooming, no horizontal page scroll (except inside tables, by design).
* **Density over decoration:** This is an operational tool used daily. Prioritize scanability and information density over whitespace-heavy marketing-site aesthetics.
* **No Breaking Elements:** Text must gracefully wrap or truncate with ellipsis (`...` + native `title` tooltip on hover for truncated text). Tables scroll horizontally on mobile rather than breaking layout, or collapse into stackable cards (component-dependent, see §7).
* **Consistency over novelty:** Every repeated pattern (a status, a currency value, a date) must render identically everywhere in the app.

---

## 2. Typography

**Primary Font:** `DM Sans` (Google Fonts) — loaded with `font-display: swap`.
**Fallback stack:** `'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
**Numeric font-feature:** `font-variant-numeric: tabular-nums;` on all numbers in tables/stat cards, so digits align in columns.

### 2.1 Type Scale

Keep sizes optimized/compact for data density — avoid oversized headers common in marketing sites.

| Token | Size (desktop) | Size (mobile) | Weight | Line-height | Usage |
|---|---|---|---|---|---|
| `text-display` | 28px | 22px | 700 | 1.2 | Page titles ("Dashboard", "Users") |
| `text-h2` | 20px | 18px | 700 | 1.3 | Section/card headers |
| `text-h3` | 16px | 15px | 600 | 1.4 | Sub-section headers, modal titles |
| `text-stat` | 32px | 26px | 700 | 1.1 | Big KPI numbers (e.g. Total Revenue) |
| `text-stat-label` | 13px | 12px | 500 | 1.4 | Label above/below stat, uppercase, `letter-spacing: 0.03em`, `text-muted` |
| `text-table-header` | 12px | 12px | 500 | 1.4 | Table column headers, uppercase, `text-muted` |
| `text-body` | 14px | 14px | 400 | 1.5 | Table rows, form values, general content |
| `text-body-strong` | 14px | 14px | 600 | 1.5 | Emphasized inline data (e.g. amount in a row) |
| `text-caption` | 12px | 12px | 400 | 1.4 | Helper text, timestamps, form hints |
| `text-badge` | 11px | 11px | 600 | 1 | Status pill text, uppercase |

**Rule:** Never go below 12px anywhere, including on mobile — hard accessibility floor.
**Rule:** Body text never exceeds 14–15px in tables/lists; larger sizes are reserved for stat cards and titles only, to keep the interface data-dense rather than "blog-like."

---

## 3. Color Palette (Tailwind Config)

```javascript
theme: {
  extend: {
    colors: {
      background: '#F8FAFC',   // Slate 50 — page background
      surface: '#FFFFFF',      // Cards, tables, modals
      surfaceAlt: '#F1F5F9',   // Slate 100 — table row hover, subtle section bg
      border: '#E2E8F0',       // Slate 200 — default borders/dividers

      primary: {
        DEFAULT: '#0F172A',    // Slate 900 — brand dark, primary buttons
        hover: '#1E293B',      // Slate 800
        active: '#020617',     // Slate 950 — pressed state
      },

      text: {
        main: '#334155',       // Slate 700 — body text
        heading: '#0F172A',    // Slate 900 — headings, high-emphasis text
        muted: '#64748B',      // Slate 500 — secondary/meta text
        disabled: '#94A3B8',   // Slate 400 — disabled text
        inverse: '#F8FAFC',    // text on dark backgrounds
      },

      success: {
        DEFAULT: '#10B981',    // Emerald 500 — Deposits, Wins, Active
        bg: '#ECFDF5',         // Emerald 50 — badge/pill background
        text: '#047857',       // Emerald 700 — badge text (better contrast than 500 on light bg)
      },
      danger: {
        DEFAULT: '#EF4444',    // Red 500 — Withdrawals, Losses, Blocked
        bg: '#FEF2F2',         // Red 50
        text: '#B91C1C',       // Red 700
      },
      warning: {
        DEFAULT: '#F59E0B',    // Amber 500 — Pending, Alerts
        bg: '#FFFBEB',         // Amber 50
        text: '#B45309',       // Amber 700
      },
      info: {
        DEFAULT: '#3B82F6',    // Blue 500 — informational states, new/in-review
        bg: '#EFF6FF',         // Blue 50
        text: '#1D4ED8',       // Blue 700
      },
    },
  }
}
```

**Contrast rule:** Any color used as body text on a light background must pass WCAG AA (4.5:1). This is why badge *text* colors (`success.text`, `danger.text`, etc.) are one or two shades darker than the `DEFAULT` swatch used for dots, icons, or chart fills.

---

## 4. Spacing, Grid & Breakpoints

### 4.1 Spacing scale (4px base unit)
`0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64` — use Tailwind defaults (`p-1`=4px ... `p-16`=64px). Never use arbitrary one-off pixel values.

* Card internal padding: `16px` mobile / `24px` desktop.
* Gap between stat cards: `12px` mobile / `16px` desktop.
* Gap between major page sections: `24px` mobile / `32px` desktop.
* Table cell padding: `12px 16px`.

### 4.2 Breakpoints (Tailwind defaults)

| Name | Width | Behavior |
|---|---|---|
| `base` | 0–639px | Single column, bottom nav, cards instead of tables (or scrollable tables) |
| `sm` | 640px | Stat cards go 2-column |
| `md` | 768px | Sidebar collapses to icon-only or drawer; tables show full horizontal scroll |
| `lg` | 1024px | Full sidebar visible; tables show all columns without scroll on standard views |
| `xl` | 1280px | Max content width kicks in |

### 4.3 Layout container
Max content width: `1440px`, centered, with `16px` mobile / `24px` tablet / `32px` desktop side gutters.

---

## 5. Core Components

### 5.1 Cards
* White (`surface`) background, **no border**, `shadow-sm` (subtle: `0 1px 2px rgba(15,23,42,0.06)`), `rounded-xl` (12px).
* Optional `hover:shadow-md` only if the card is clickable/interactive.
* Stat cards: icon (top-left, 20px, muted color in a soft `surfaceAlt` circle), label (`text-stat-label`), value (`text-stat`), optional trend delta (small colored badge: green up / red down + `%`).

### 5.2 Buttons
| Variant | Style |
|---|---|
| Primary | Solid `primary.DEFAULT` bg, white text, `rounded-lg`, `hover:primary.hover` + `hover:-translate-y-[1px]` + `hover:shadow-md` transition (150ms ease) |
| Secondary | White bg, `border-slate-200`, `text-main`, `hover:bg-surfaceAlt` |
| Danger | Solid `danger.DEFAULT` bg, white text — used for destructive actions (Block user, Delete, Reject) |
| Ghost/Text | No bg/border, `text-muted`, `hover:text-heading` — used for tertiary actions like "Clear filters" |
| Icon button | 36×36px hit area minimum (touch target), `rounded-lg`, `hover:bg-surfaceAlt` |

Sizes: `sm` (32px height, 13px text) for inline table actions, `md` (40px height, 14px text) default, `lg` (48px height) for primary mobile CTAs.

### 5.3 Inputs & Forms
* `border-slate-200`, `rounded-lg`, `40px` height, `14px` text, `16px` horizontal padding.
* Focus state: `ring-2 ring-primary/20 border-primary` — **no default blue browser outline** (`outline: none` + custom ring via `:focus-visible`).
* Error state: `border-danger`, small `text-caption text-danger` message below with an alert icon.
* Placeholder: `text-disabled`.
* Disabled: `bg-surfaceAlt`, `text-disabled`, `cursor-not-allowed`.
* Label: `text-caption font-medium text-main`, `4px` margin-bottom.

### 5.4 Status Badges / Pills
Used constantly for transaction/user states (Active, Blocked, Pending, Deposit, Withdrawal, Win, Loss).
* `rounded-full`, `px-2.5 py-0.5`, `text-badge` (11px, uppercase, weight 600).
* Background = `{color}.bg`, text = `{color}.text`. Optional leading 6px dot in `{color}.DEFAULT`.
* Mapping example: `Active/Deposit/Win` → success · `Blocked/Withdrawal/Loss` → danger · `Pending/Review` → warning · `New/Info` → info.

### 5.5 Icons
`lucide-react`, stroke width `1.75–2`, default size `18px` inline / `20px` in buttons / `24px` in stat card icon circles. Always paired with an accessible label (`aria-label` if icon-only).

### 5.6 Tooltips
Dark (`primary.DEFAULT`) background, white text, `text-caption`, `rounded-md`, small arrow, 4px offset, appear on hover (desktop) / long-press (mobile, rare — prefer visible labels on mobile instead of tooltips).

### 5.7 Tabs
Underline style: `text-muted` inactive, `text-heading` + `border-b-2 border-primary` active. Horizontally scrollable on mobile if tabs overflow (no wrapping).

---

## 6. Data Display: Tables

### 6.1 Structure
* Header row: `surfaceAlt` background, `text-table-header`, **sticky** (`sticky top-0 z-10`) when the table body scrolls vertically.
* Row: `border-b border-slate-100` (not full borders — cleaner), `hover:bg-surfaceAlt` transition.
* Row height: `52px` desktop / `48px` mobile (comfortable touch target).
* Zebra striping: **not used** — rely on hover + row dividers only, per minimal aesthetic.

### 6.2 Horizontal Scroll (Mobile / Overflow Tables)
When a table's natural width exceeds the viewport:
* Wrap the `<table>` in a container: `overflow-x-auto` with `-webkit-overflow-scrolling: touch`.
* **Persistent visual scrollbar** (not just scroll-on-drag): style the scrollbar so it's always discoverable —
  ```css
  .table-scroll::-webkit-scrollbar { height: 6px; }
  .table-scroll::-webkit-scrollbar-track { background: #F1F5F9; border-radius: 999px; }
  .table-scroll::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 999px; }
  .table-scroll::-webkit-scrollbar-thumb:hover { background: #94A3B8; }
  ```
* First column (e.g. "User") is `sticky left-0` with a subtle right-side shadow/divider (`box-shadow: 4px 0 6px -4px rgba(0,0,0,0.08)`) so identity stays visible while scrolling through data columns — this matters more than hiding columns for dense financial data.
* A slim gradient fade (`16px` wide, `linear-gradient(to right, transparent, background)`) on the right edge hints there's more content, disappearing once scrolled to the end.

### 6.3 Column Priority (small screens < 768px)
Rather than hiding data outright, prefer horizontal scroll + sticky first column (§6.2) so no data is lost. If a **card-collapse** pattern is used instead for a given table:
* Show: primary identifier, action/type, amount/status.
* Hide behind an "Expand" chevron (rotates 180° on open, 150ms ease): Created Date, ID, secondary metadata — revealed in a stacked key-value drop-down row inside the card.

### 6.4 Empty State
Centered inside the table container: muted icon (32px), `text-h3` "No results found", `text-caption text-muted` explaining why (e.g. "Try adjusting your filters"), optional "Clear filters" ghost button.

### 6.5 Loading State
Skeleton rows (`animate-pulse`, `surfaceAlt` bars matching column widths) — never a blocking spinner over existing data during pagination/filter changes; only full-table skeleton on first load.

---

## 7. Pagination

* Placed bottom-right of the table card (bottom, full-width stacked on mobile).
* Shows: `"Showing 1–10 of 248"` (`text-caption text-muted`) on the left, page controls on the right.
* Controls: Previous / Next icon buttons (36px, disabled state at boundaries) + numbered page buttons (current page: `primary` solid pill; others: ghost). Collapse to `1 ... 4 [5] 6 ... 24` pattern beyond 7 pages.
* **Rows-per-page selector** (10 / 25 / 50 / 100) as a compact dropdown next to the "Showing X of Y" text — persists via query param so refresh doesn't reset it.
* Mobile: simplify to `[< Prev]  Page 3 of 24  [Next >]` — no numbered page list, full-width tap targets (44px min height).

---

## 8. Filters

### 8.1 Filter bar
Sits directly above the table inside the same card, or as a separate `surface` bar above it. Contains, in order:
1. **Search input** (icon-left, `flex-1`, debounced 300ms) — searches primary fields (user, ID, email).
2. **Dropdown filters** (Status, Type, Date Range) — each a `Secondary` button showing current selection + chevron, opening a popover (desktop) or bottom sheet (mobile) with checkboxes/radio options.
3. **Date range picker** — presets (Today, 7 days, 30 days, Custom) + calendar for custom range.
4. **"Clear all"** ghost text button — appears only when ≥1 filter is active.

### 8.2 Active filter chips
Below the filter bar, show applied filters as removable chips: `rounded-full`, `surfaceAlt` bg, `text-caption`, small `×` to remove. Lets users see and undo filters at a glance without opening each dropdown.

### 8.3 Mobile behavior
Filter bar collapses into a single "Filters" button with a count badge (e.g. "Filters (3)") that opens a full bottom Sheet containing all filter controls stacked vertically, with a sticky "Apply" button at the bottom of the sheet.

---

## 9. Modals & Sheets

* **Desktop:** Centered Dialog, `max-w-lg` (or `max-w-2xl` for forms), `rounded-xl`, `shadow-lg`, backdrop `bg-black/40 backdrop-blur-[2px]`. Close via `×` icon top-right, `Esc` key, or backdrop click (except for destructive-confirmation modals — require explicit choice).
* **Mobile:** Bottom-anchored slide-up Sheet, `rounded-t-2xl`, full-width, drag handle bar (small `slate-300` pill, centered, top of sheet) to signal it's swipe-dismissible. Max height `90vh` with internal scroll if content overflows.
* **Destructive confirmations** (Block user, Reject withdrawal): always require a named action button ("Block user", not just "Confirm") in `danger` variant, paired with a `Secondary` "Cancel".

---

## 10. States, Motion & Accessibility

### 10.1 Interactive states (apply to all clickable elements)
`default → hover → active/pressed → focus-visible → disabled`. Hover only on devices that support `hover` (`@media (hover: hover)`) — avoid sticky hover states on touch devices.

### 10.2 Focus (accessibility-critical)
Every focusable element gets a visible `:focus-visible` ring (`ring-2 ring-primary/30`, `ring-offset-2`) — never `outline: none` without a replacement. Tab order must follow visual/reading order.

### 10.3 Motion
Keep purposeful and fast — this is a tool, not a showcase: `150–200ms ease-out` for hovers, dropdowns, sheet slide-ins; `100ms` for button presses. Respect `prefers-reduced-motion: reduce` (disable slide/scale transitions, keep only opacity fades).

### 10.4 Color contrast & touch targets
All text meets WCAG AA. All tappable elements ≥ `40×40px` (mobile), ideally `44×44px` for primary actions. Never convey status by color alone — pair every status badge/dot with a text label.

### 10.5 Numeric formatting
Currency always right-aligned in tables, with consistent decimal places and thousands separators (e.g. `$12,480.00`). Negative amounts (withdrawals/losses) in `danger.text`, prefixed with `-`, not just parentheses.

---

## 11. Elevation Scale

| Token | Value | Usage |
|---|---|---|
| `shadow-sm` | `0 1px 2px rgba(15,23,42,0.06)` | Cards, table container |
| `shadow-md` | `0 4px 12px rgba(15,23,42,0.08)` | Hover-lift cards, dropdown popovers |
| `shadow-lg` | `0 10px 30px rgba(15,23,42,0.12)` | Modals, sheets |

---

## 12. Navigation

* **Desktop (≥1024px):** Fixed left sidebar, `256px` wide, `primary.DEFAULT` or `surface` background (pick one and stay consistent), collapsible to icon-only `64px` rail.
* **Tablet (768–1023px):** Sidebar becomes an overlay drawer, triggered by a hamburger icon in the top bar.
* **Mobile (<768px):** Bottom tab bar (fixed, `56px` height, `surface` bg, top `border`) for the 4–5 primary sections; overflow items live under a "More" tab. Top bar keeps page title + search/notification icons only.