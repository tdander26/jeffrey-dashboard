# Handoff: Spend Tracking — Pace Dials

## Overview

A new **Spend** tab for the Anderson Ledger Profit First dashboard that surfaces bucket-by-bucket pacing across 15-day allocation windows. The data source is SimpleFIN's `/accounts` call (already retrieves transactions for every linked account); the implementation should extend `SimpleFin.gs` to write a third sheet tab called **Transactions** with columns: `Date | Account | Amount | Payee | Memo`. The dashboard then slices that data by account → bucket and by allocation window.

**Two windows per cycle:**
- 10th → 24th  (15 days)
- 25th → 9th of next month (~15 days)

For each bucket, per window: total outflow, transaction count, % of that period's allocation consumed, and a pacing comparison against expected progress (% of window elapsed).

## About the Design Files

The HTML/JSX files in this bundle are **design references** — a working prototype showing intended look and behavior, not production code to ship as-is. The task is to recreate this UI in the existing Anderson Ledger codebase using its established patterns (currently a Google Apps Script + HTMLService dashboard, judging from the screenshot reference). If the dashboard is being moved to a different framework (React/Vue/etc.), use those conventions instead — the design intent and data shape carry over either way.

## Fidelity

**High-fidelity.** Final colors, type scale, spacing, and interactions. Recreate pixel-perfectly within the host environment. The existing dashboard's visual vocabulary (warm off-white background, hairline borders, muted bucket pills, navy primary action) is matched throughout — see `existing-dashboard-reference.png`.

## Files in this bundle

| File | Purpose |
|---|---|
| `index.html` | Standalone runnable demo. Open in a browser to see the design live. |
| `option3-pace-dials.jsx` | The Pace Dials view itself — the deliverable. |
| `data.jsx` | Mock data + `deriveWindow()` helper. The data shapes here are the contract the backend should produce. |
| `chrome.jsx` | Page header, tab bar, KPI strip, `Card` wrapper, and the `T` design-token object. Match these exactly. |
| `existing-dashboard-reference.png` | Screenshot of the current Profit First tab — match this visual vocabulary. |

## Screen: Spend tab

### Layout (top → bottom)

1. **Header bar** (existing chrome — already present in the dashboard)
   - Logo monogram + "Anderson Ledger" + subtitle "DR TODD ANDERSON · MOMENTUM HEALTH · FY 2026"
   - Tab pill group: Profit First / Taxes / Payroll / **Spend** ← new tab, active
   - Right side: Synced indicator · Print · + Add Entry

2. **KPI strip** — 4 cards in a `repeat(4, 1fr)` grid, 12px gap, 28px page margin:
   - Window inflow — `$9,420` · "Apr 25 – May 9 · day 4 of 15"
   - Spent so far — `$2,600` · "9 transactions · 28% of allocation" · green dot
   - Pacing health — "On pace" or "N off pace" · status dot (green if all on pace, amber otherwise)
   - Allocation total — "100%" · "32 of 32 rows compliant"

3. **Card: "Allocation pacing"** — header includes a legend (On pace / Off pace).
   - Body: 4-column grid of `DialCard`s — one per bucket (OpEx, Owner's Pay, Tax, Profit).

4. **Card (conditional): transaction drill-in** — appears when a bucket's "View N transactions" button is clicked. Displays the same `DialTxns` table with date/payee/memo/amount columns.

5. **Card: "Window-over-window"** — a compact table: bucket rows × last 6 windows columns. Each cell shows `% consumed` (large) and `$ spent` (small). Prior columns at 50% opacity; current column full.

### Component: DialCard (the centerpiece)

Border: 1px `#E8E4DC`, radius 8, padding 16/16/14, background `#FDFCF8`.

Internal layout, top → bottom:
1. **Header row**: bucket dot (10×10, `b.color`) + bucket label (13/600) on the left; allocation % (10.5/inkFaint) on the right.
2. **Gauge** — 160×100 SVG. Semi-circle arc, radius 58, center (80, 78), 10px stroke width.
   - Track: `#F1EDE3`
   - Fill arc: `b.color`, 0–100%
   - Overflow arc: `#C7A876`, 100–130% (clipped at 130)
   - Pace tick: 2px black line at the angle corresponding to `elapsedPct` (% of window elapsed)
   - Center text: 22/600 % consumed (e.g. "28%"), letter-spacing -0.5
   - Below center: 9px uppercase "consumed" label, fill `inkFaint`
3. **Pace caption**: `+X% ahead` (warn color `#8A6A2B`) or `X% under` (`inkMute`). Centered.
4. **Spent / Remaining row** — split into two columns separated by a top border. Tiny uppercase label + 13/600 number, left-aligned and right-aligned.
5. **"Last 6 windows vs budget" sparkline** (see below).
6. **"View N transactions"** toggle button — full-width, transparent → `b.chip` background when expanded.

### Component: Sparkline (the budget chart inside each DialCard)

Critical: this chart MUST make the budget range visually unmistakable. It is not just a sparkline — it is a tiny budget chart.

SVG dimensions: viewBox `0 0 240 88`, rendered full-width inside the card.
- `padL: 28, padR: 8, padT: 14, padB: 16`
- Y-axis range: 0 → max(130, max(data) + 10) so over-budget points always have headroom.

Visual layers (back → front):
1. **Safe zone band** — green `#EEF3EC` rectangle covering 0–100%.
2. **Over zone band** — amber `#F7EAD9` at 0.55 opacity covering 100% to top of chart.
3. **Y-axis labels** — at 0%, 50%, 100%. 8.5px, right-aligned, tabular-nums.
4. **50% gridline** — 1px `borderSoft`, dashed `1 3`.
5. **100% budget line** — 1.25px `#8A6A2B`, dashed `3 2`. Label "BUDGET" at the right end, 8.5/600 uppercase letter-spacing 0.5.
6. **Y-axis + X-axis baseline** — 1px `#E8E4DC`.
7. **Trend line** — 1.75px `b.color`.
8. **Points** — 2.2px radius for prior windows (filled with `b.color`); 3px radius for the current/last window (filled black `T.ink`). All have a 1px white stroke.
9. **Per-point labels** — `Math.round(value) + "%"` above each dot. 8.5px, weight 600 for the last point, 500 for others. Color: amber `#8A6A2B` if over 100%, ink for the last point, inkMute for prior.

### Component: Window-over-window table

Below the dial grid. Single grid: `170px repeat(6, 1fr)`, columnGap 8.
- Header row: "Bucket" + 6 window labels (10px uppercase, fade prior windows to opacity 0.6).
- Body rows: bucket dot + label, then per-window cell with 14/600 % consumed and 10.5px `$ spent`. Prior columns at opacity 0.5.

### Component: DialTxns (drill-in table)

Grid: `80px 1fr 1fr 110px` for Date / Payee / Memo / Amount. Header row in `#FBF8F1`, 10px uppercase. Rows: 12px ink, separators are 1px `borderSoft`. Amount column right-aligned, tabular-nums.

If no transactions in the window: render placeholder text `"No transactions yet this window."` in `inkFaint` 12px.

## Interactions & Behavior

- **Bucket click → expand transactions.** Clicking "View N transactions" on a `DialCard` opens a second `Card` below the dial grid showing `DialTxns` for that bucket. Only one bucket expanded at a time. The toggle button label switches "View" ↔ "Hide" and the button fills to the bucket's chip color when expanded.
- **No animation** required for v1, but if added: 150ms ease-out on expand height + fade.
- **Hover states:** subtle border darken on `DialCard` and on toggle button — keep restrained.
- **Off-pace warning is muted** (amber `#F7EAD9` background, `#8A6A2B` ink), never red. The user explicitly asked for subtle alerting.
- **Current window emphasized**: full opacity. Prior windows: 0.5–0.6 opacity. This is consistent across the dial cards' sparklines and the window-over-window table.

## Data contract

The view consumes two inputs: `allocPct` (per-bucket %) and `currentDay` (1–15). All other data comes from globals built from the Transactions sheet.

```js
BUCKETS = [
  { id, label, pct, color, chip, chipText, account }, ...
]

WINDOWS = [
  { id, start, end, monthLabel, inflow, days, status: "closed" | "current", dayIndex? },
  ...
]   // ordered oldest → newest; last entry is current

SPEND = {
  [windowId]: { opex, oc, tax, profit, txns }, ...
}

TXNS = {
  [bucketId]: [ { date, payee, memo, amount }, ... ]
}
```

The helper `deriveWindow(win, allocPctOverride)` returns:
```js
{
  win,
  txnCount: number,
  buckets: [
    {
      ...bucket,
      alloc,         // win.inflow * pct/100
      spent,
      remaining,
      pctConsumed,   // spent / alloc * 100
      elapsedPct,    // dayIndex / days * 100 (current) or 100 (closed)
      pace,          // pctConsumed - elapsedPct (positive = ahead/over)
      status,        // "over" | "warn" | "on-pace"
    }, ...
  ]
}
```

Status thresholds: `> 100% → "over"`, `> elapsedPct + 8 → "warn"`, else `"on-pace"`.

## Backend extension (SimpleFIN integration)

Extend `SimpleFin.gs` so the existing `/accounts` fetch also writes a **Transactions** sheet:

| Column | Source |
|---|---|
| Date | `transaction.posted` (epoch → date) |
| Account | account name (e.g. "Chase · OPEX (7712)") |
| Amount | `transaction.amount` (negative = outflow) |
| Payee | `transaction.payee` |
| Memo | `transaction.memo` or `transaction.description` |

The dashboard tab then groups outflows by Account → PF Bucket assignment (already mapped in the Live Bank Balances section) and by allocation window date range.

**Window assignment:** a transaction dated on or after the 10th and before the 25th belongs to the `10th → 24th` window of that month; otherwise to the `25th → 9th` window (which spans into the next month).

## Design Tokens

Reuse the existing dashboard's tokens. Defined in `chrome.jsx` as `T`:

```
bg:          #FAF8F4   — page background (warm off-white)
card:        #FFFFFF   — card surface
border:      #E8E4DC   — hairline border
borderSoft:  #EFEBE3   — internal dividers
ink:         #1F1D1A   — primary text
inkMute:     #6B6760   — secondary text
inkFaint:    #9A958C   — tertiary text / labels
navy:        #1F2A37   — primary button
greenPill:   #D9EAD8   — synced/success pill bg
greenPillText: #3A6A3F
amberPill:   #F5E6C8
amberPillText: #7A5A1E
warnSoft:    #F2E2C9   — over-budget zone bg
warnInk:     #8A6A2B   — over-budget ink + budget line
```

Bucket colors (defined per-bucket in `data.jsx`):

| Bucket | Color | Chip bg | Chip ink |
|---|---|---|---|
| OpEx | `#7BA89A` | `#E6EFEA` | `#3F6757` |
| Owner's Pay | `#9AB3CC` | `#E6ECF3` | `#3F5878` |
| Tax | `#D4A8A8` | `#F1E3E3` | `#7C4848` |
| Profit | `#B7A4C9` | `#ECE4F1` | `#5F4878` |

Sparkline-specific:
- Safe zone band: `#EEF3EC`
- Over zone band: `#F7EAD9` (0.55 opacity)
- Budget line / over labels: `#8A6A2B`

## Typography

- **Body / UI:** Inter, weights 400 / 500 / 600 / 700.
- All numeric displays: `font-variant-numeric: tabular-nums`.
- Section labels: 10px, letter-spacing 0.4, uppercase, color `inkFaint`.
- KPI numbers: 26 / 600, letter-spacing -0.5.
- Card titles: 14.5 / 600, letter-spacing -0.1.
- Gauge center number: 22 / 600.
- Sparkline labels: 8.5 / 500–600.

## Spacing

- Page horizontal margin: 28px
- Card vertical rhythm: 16px between cards (`margin: 16px 28px 0 28px`)
- Card internal padding: 14/18 header, 18 body
- DialCard internal: 16/16/14 padding
- Dial grid gap: 14px

## How to run the demo

Open `index.html` directly in a browser. It loads React + Babel from a CDN and the three JSX files. No build step needed.

## Notes for the implementer

- The current pacing comparison (`pace = pctConsumed - elapsedPct`) is the core heuristic. If it ever proves too noisy in practice, expose the threshold (currently `+8%`) as a config.
- The "+X% ahead / X% under pace" caption uses absolute values for the under case — keep that wording; it reads more naturally than "-3% ahead".
- The pace tick on the gauge can disappear into the arc when `elapsedPct ≈ pctConsumed`. That's intentional — visual confirmation that you're exactly on pace.
- The window labels (`monthLabel`) use an en dash, not a hyphen.
- The sparkline's Y max grows to fit overflowing values — never clip a point off the chart.
- All four bucket cards render at the same height regardless of content. Don't conditionally hide rows.
