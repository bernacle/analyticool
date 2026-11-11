# Customer-CSS-first embed theming (BRU-485)

Status: **prototype contract** on the existing result-prop SDK (`<MetricChart result />`, `<MetricKpi result />` in `@analyticool/react`). This is the single SDK that [BRU-465](https://linear.app/brunosimplicio/issue/BRU-465) (versioned API, typed SDK) and [BRU-466](https://linear.app/brunosimplicio/issue/BRU-466) (onboarding examples) should extend. There is no hosted `<Metric id view token>` component, and no token, auth or session service.

Working example: `/embed-themes` ([`apps/demo/app/embed-themes/`](../../../apps/demo/app/embed-themes/)). It renders one synthetic result in (a) the Analyticool default appearance (Darkroom B+) and (b) a fictional light customer theme, Ledgerly.

## Proposed styling API

**The package ships no CSS.** It has no stylesheet, no `<style>` or `<link>`, no font loading, no grain, no background image and no motion. Every visual value is an inline `var(--ac-*, neutral fallback)`, so an embed with no theming already matches the host's font and text colour.

### Variables

Set these on any ancestor (scoped to your own selector) or through `style`. They inherit like any custom property.

| Variable           | Used for                                     | Fallback                                            |
| ------------------ | -------------------------------------------- | --------------------------------------------------- |
| `--ac-font`        | Root `font-family`                           | `inherit`                                           |
| `--ac-ink`         | Root text colour (caption, table, KPI value) | `inherit`                                           |
| `--ac-muted`       | KPI label, axis ticks, table caption         | `color-mix(in srgb, currentColor 72%, transparent)` |
| `--ac-line`        | Table row rules                              | `color-mix(in srgb, currentColor 20%, transparent)` |
| `--ac-grid`        | Chart grid lines                             | `color-mix(in srgb, currentColor 12%, transparent)` |
| `--ac-series`      | Line and points                              | `currentColor`                                      |
| `--ac-surface`     | Root background                              | `transparent`                                       |
| `--ac-radius`      | Root border radius                           | `0`                                                 |
| `--ac-figure-size` | KPI value font size                          | `2.25em`                                            |

`MetricThemeVariable` (a union of these names) and `MetricThemeVariables` are exported types, so `style={{ "--ac-series": "teal" }}` type-checks.

### Hooks

- **Root classes:** `ac-metric-chart` (a `<figure>`) and `ac-metric-kpi` (a `<dl>`). `className` is appended to them.
- **`style`** is merged last onto the root, so it overrides the root's inline defaults (`margin`, `font-family`, `color`, `background`, `border-radius`).
- **Parts:** `[data-ac-part="…"]` on `caption`, `plot` (the `<svg>`), `grid`, `axis`, `series`, `point`, `details`, `summary` and `table` in the chart, and `label` and `value` in the KPI.
- **Tooltip:** each point has a native SVG `<title>`, for example "Jun 2026: $3,420.00".

### Rules

1. **Inherit first.** Font and colour come from the host unless `--ac-font` or `--ac-ink` is set. Font sizes are in `em`, so they follow the host's size.
2. **Properties the components don't set** (padding, border, shadow, `outline`, `:focus-visible`, `color` on parts without an inline colour, text decoration) can be styled with ordinary CSS through the class and part hooks.
3. **Properties the components set inline** on a part (for example the caption's `font-weight: 600`, the summary's `font-size`, the table's `border-collapse`) can't be overridden by a class selector without `!important`. Use a variable where one exists. See "Unstyled mode" below.
4. **Focus belongs to the host.** Inline styles can't express `:focus-visible`, so the package doesn't set an outline. The browser default ring applies until the host adds one (both example themes do). For this reason SPEC's proposed `--ac-focus` is not part of the contract: it would be a variable the package can't read.

## Minimal copyable CSS

Analyticool default appearance (Darkroom B+ tokens from [SPEC §1/§2](../darkroom/SPEC.md)). Geist is named but never loaded. If the host doesn't load it, the system stack is used.

```css
.my-dashboard {
  --ac-font:
    Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --ac-ink: #efebe4;
  --ac-muted: #8f897e; /* 5.4:1 on the card */
  --ac-line: rgba(255, 240, 220, 0.1);
  --ac-grid: rgba(255, 240, 220, 0.065);
  --ac-series: #aca4f6;
  --ac-surface: #161412;
  --ac-radius: 16px;
  --ac-figure-size: 2.5rem;
}
.my-dashboard .ac-metric-chart,
.my-dashboard .ac-metric-kpi {
  padding: 24px;
}
.my-dashboard :focus-visible {
  outline: 2px solid #aca4f6;
  outline-offset: 2px;
}
```

Fictional customer theme (light, serif, bordered). It sets **no `--ac-font`**; the embeds inherit the host font.

```css
.ledgerly {
  font-family: Charter, "Iowan Old Style", Georgia, serif;
  --ac-ink: #111827;
  --ac-muted: #4b5563;
  --ac-line: #e5e7eb;
  --ac-grid: #e5e7eb;
  --ac-series: #c2410c;
  --ac-surface: #ffffff;
  --ac-radius: 4px;
  --ac-figure-size: 2rem;
}
.ledgerly .ac-metric-chart,
.ledgerly .ac-metric-kpi {
  padding: 20px;
  border: 1px solid #d1d5db;
}
.ledgerly [data-ac-part="summary"] {
  color: #9a3412;
  text-decoration: underline;
}
.ledgerly :focus-visible {
  outline: 2px solid #c2410c;
  outline-offset: 2px;
}
```

The example page's full host CSS is in [`themes.css`](../../../apps/demo/app/embed-themes/themes.css). It is scoped under `.embed-themes` and has no `:root`, `html`, `body` or `*` rules.

## Constraints

- **No shipped CSS.** The Analyticool default appearance exists only as copyable CSS (above and in the example), not as a package stylesheet or exported object.
- **Browser floor:** the fallbacks use `color-mix()` (Chrome/Edge 111, Safari 16.2, Firefox 113). Older browsers ignore those declarations, which leaves the muted, line and grid colours at their initial values. Set the variables explicitly if you need older browsers.
- **SVG text scales with the chart.** Axis labels are 11 viewBox units in a 700-unit-wide `viewBox`, so they shrink with the container. In the example's layout that is roughly 11 × 254 / 700 ≈ 4px at a 390px viewport and about 7–8px in a half-width desktop column. That is below SPEC §2's 12px floor, and it predates this change. Colour contrast passes, but size doesn't. The exact-value table is the readable, accessible alternative today. A responsive axis (HTML labels, or a `viewBox` that tracks the container width) should be decided in BRU-465.
- **Inline specificity.** See rule 3. Variables and root `style` cover every colour, font and surface. Part-level typography needs `!important` today.
- **Next.js note for the example:** global CSS is not removed on client-side navigation, so `themes.css` is selector-scoped, and the root layout no longer imports `globals.css`; the demo page at `/` imports it itself. This is example plumbing, not part of the SDK.

## Ergonomics

- No new props for theming beyond `style`; the `result` prop and runtime validation are unchanged. Existing callers render the same markup, now neutral and inherited instead of slate-coloured.
- Theming works the same with plain CSS, CSS Modules or Tailwind arbitrary properties (`[--ac-series:#0f766e]`), because it is all inherited custom properties.
- A host light/dark switch recolours the chart with no JS: change the variables under a `[data-theme]` selector.
- The components stay server-renderable (no `"use client"`, no effects), so there is no hydration-sensitive styling.

## Package size

The package ships **TypeScript source, not a bundle**, so this measures the component source file. The size is checked in `packages/react/src/metric-chart.test.tsx` with Node's `zlib.gzipSync(source, { level: 9 })`:

| `packages/react/src/metric-chart.tsx` | Raw     | gzip -9 |
| ------------------------------------- | ------- | ------- |
| Before (`main` at `de7dc47`)          | 5,317 B | —       |
| After                                 | 7,923 B | 2,674 B |

The unit test enforces a 3 KiB gzip budget. No CSS ships, so 0 B of CSS is added; the themes are host-owned and copied into the host's own stylesheet.

## Unstyled mode: not added

The plan was to add `theme="none"` only if the fallbacks can't be neutralised with plain CSS. **They can:**

- Both themes, including a light/serif/bordered one, were built using only variables, root classes, part hooks and host font inheritance. Neither needed `!important` or a prop.
- With no variables set, the components already inherit the host's font and colour, with a transparent surface, no radius and currentColor-derived tints. That is effectively "unstyled" for colour and type.
- What remains is a little structural inline typography on parts (caption weight, `em` font sizes, table padding). Overriding that needs `!important` (rule 3).

**Recommendation for BRU-465:** if customer feedback shows part typography needs overriding, add an `unstyled` boolean that drops the non-structural inline styles on parts. That would be additive and wouldn't change the variable contract.

## Validation

Automated:

- **Unit (SSR, `packages/react/src/metric-chart.test.tsx`):**
  - `className` and `style` are merged onto both roots.
  - Every part hook is present.
  - There are no hex or `rgb()` literals, and every colour-bearing property reads `var(--ac-`.
  - The series and points use `var(--ac-series`.
  - No `<style>`, `<link>`, `<script>`, `transition`, `animation`, `url()` or Geist appears in the markup.
  - Each point has a `<title>` with the exact cents.
  - The size budget holds.
  - The existing exact-cent, zero-series and invalid-result tests still pass.
- **Browser smoke (`tests/smoke/embed-themes.spec.ts`, run with `pnpm build && pnpm test:smoke`):**
  - The page is server-rendered.
  - Computed font, series stroke, point fill, surface and radius match each theme's variables, and they differ between the themes.
  - Each embed's font equals its host section's font, and the customer theme sets no `--ac-font`.
  - Every loaded CSS rule is scoped under `.embed-themes`, there is no Tailwind or `:root`, and the UA body margin is untouched.
  - Host elements' computed styles are identical before and after the embeds are removed from the DOM (the leak check).
  - Tab reaches "View exact values" in both themes with a non-`none` outline, and Enter opens the table.
  - Label, value, caption, summary, table and axis text reach at least 4.5:1 in both themes.
  - Hovering a point exposes its `<title>`.
  - Under `prefers-reduced-motion: reduce` there are no animations, no transitions and no running `document.getAnimations()`.
  - There is no horizontal overflow at 390px.
  - There are no console, page or hydration errors.

Screenshots, written by the same smoke run:

- Desktop, both themes: [`screenshots/embed-themes-desktop.png`](screenshots/embed-themes-desktop.png)
- 390px: [`screenshots/embed-themes-mobile.png`](screenshots/embed-themes-mobile.png)
- Analyticool default: [`screenshots/embed-theme-analyticool.png`](screenshots/embed-theme-analyticool.png)
- Customer theme: [`screenshots/embed-theme-customer.png`](screenshots/embed-theme-customer.png)

## Not in scope / open

- **Legend:** there is a single series, so the `<figcaption>` serves as the legend. A legend part arrives with multi-series charts.
- **Tooltip:** the native `<title>` isn't keyboard-reachable. The exact-value table is the keyboard and screen-reader path. An interactive tooltip is future work.
- **Dark variant of the customer theme:** not built. The contract supports it through variables alone (see Ergonomics).
- **Hosted `<Metric>`, a `theme` prop, a shipped default theme file:** Proposed only (SPEC §8/§9).
