# Darkroom B+ design specification

Status: approved visual direction (BRU-456). The reference prototype lives in [`prototype/`](prototype/); see the [README](README.md) to run it.

Principle: **complexity belongs in the engine, not on the screen.** Every screen answers one question first:

| Screen   | Question                                       | Biggest thing      | One primary action                  |
| -------- | ---------------------------------------------- | ------------------ | ----------------------------------- |
| Describe | What do you want to measure?                   | Composer           | Continue                            |
| Clarify  | Which of these did you mean?                   | The question       | Continue / See the result           |
| Review   | Is this number right, and should I approve it? | Figure + chart     | Approve metric → Add it to your app |
| Embed    | How do I get this into my app?                 | Preview, then code | Copy code                           |

Anything marked **Proposed** describes intended product behaviour that the repository does not implement yet (see §9).

## 1. Colour tokens

Dark only for v1. Defined in [`prototype/base.css`](prototype/base.css) and [`prototype/shell.css`](prototype/shell.css).

| Token                       | Value                                                                       | Use                                                                                      |
| --------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `--ground`                  | `#0B0A09`                                                                   | Page, sidebar and top bar (one ground)                                                   |
| `--card`                    | `#161412`                                                                   | First elevation: hero, decision band, composer, options                                  |
| `--nested`                  | `#211E1B`                                                                   | Second elevation: segmented track, quiet buttons                                         |
| `--nested-2`                | `#2A2723`                                                                   | Selected segment, hover on nested surfaces                                               |
| `--overlay`                 | `#1E1C19`                                                                   | Drawer (it floats, so it may carry a shadow)                                             |
| `--ink`                     | `#EFEBE4`                                                                   | Text and the primary button fill                                                         |
| `--muted`                   | `#ADA79C`                                                                   | Secondary text (7.9:1 on `--card`)                                                       |
| `--faint`                   | `#8F897E`                                                                   | Labels, meta, axis ticks (5.4:1 on `--card`)                                             |
| `--off`                     | `#57524A`                                                                   | Disabled marks only; never carries words                                                 |
| `--line-1/2/3`              | `rgba(255,240,220,.065 / .1 / .17)`                                         | Row rules, inset edges, disabled outline                                                 |
| `--accent`                  | `#ACA4F6`                                                                   | Iris: the approved data line, focus ring, selected option. Never on buttons, tabs or nav |
| `--ok` / `--warn` / `--err` | `#76C39A` / `#E6AE62` / `#EE8473`                                           | Status as dot + word, never as fills                                                     |
| Syntax                      | kw `#C3B8F7`, fn `#E9D9B8`, str `#D8CBA6`, num `#C2BE72`, comment `#8F897E` | Code only (strings are sand, not terracotta)                                             |
| `--grain`                   | `.015`                                                                      | Opacity of the CSS noise on the ground only                                              |

Elevation comes from lightness, never from borders or shadows on resting surfaces. Radius is soft and decided once: cards `16px`, inner surfaces `12px`, controls fully round, `kbd` `4px`.

## 2. Typography

Faces are roles, so they can be replaced without touching components:

| Token                                                                         | Default                    | Role                               |
| ----------------------------------------------------------------------------- | -------------------------- | ---------------------------------- |
| `--sans`                                                                      | Geist                      | UI text, figures (tabular)         |
| `--mono`                                                                      | Geist Mono                 | Code and identifiers only          |
| `--serif`                                                                     | Instrument Serif           | Source for the display role        |
| `--font-display`, `--display-weight`, `--display-tracking`, `--display-scale` | `--serif`, 400, −0.01em, 1 | The one expressive line per screen |

**The editorial serif is optional.** Setting `data-display="sans"` on `<html>` (or `?display=sans` in the prototype) maps the display role to Geist 600, −0.028em, ×0.86. No component changes, and the serif is never downloaded.

| Role                  | Spec                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Page title / question | Display role: 36/40 (Describe 40/44, Clarify question 32/38), `text-wrap: balance`. Phone 30/34 (question 26/31) |
| Hero figure           | Geist 500, 40/44, −0.03em, tabular. Never serif                                                                  |
| Lead                  | Geist 15/24, `--muted`, max 64ch                                                                                 |
| Body / rows           | Geist 14/20 (Clarify options 16/24)                                                                              |
| Card title            | Geist 500, 14–16                                                                                                 |
| Label / meta / axis   | Geist 13/18 in `--faint`; axis ticks 12                                                                          |
| Code                  | Geist Mono 13.5/24 (phone 12.5)                                                                                  |
| Floor                 | 11px (`kbd` only); everything that is read is 12px or larger                                                     |

Budget: exactly one display line per screen.

## 3. Layout and spacing

- **Shell:** sidebar `232px` and top bar `64px` share the ground, divided by 1px `--line-1` rules. The top bar holds the location (left), the creation stages Describe — Clarify — Review — Embed (current in ink, finished ones linkable) and the workspace switcher behind a full-height divider (right).
- **Content column**, centred in the canvas: `880px` for Review and Embed, `720px` for Describe, `680px` for Clarify. Canvas padding `56px 29px 80px`.
- **Rhythm** on a 4px base: card padding 24–32px, 16px between cards, 40–56px between sections, 12px from title to lead, 36–40px from lead to the first block.
- **Rows:** 44–48px key/value rows with 1px `--line-1` dividers; numbers right-aligned in tabular figures.

## 4. Components

| Component              | Spec                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary button         | Inverted pill: `--ink` fill, `--ground` label, 36px (44px on phones). One per screen                                                                 |
| Default / quiet button | `--nested` fill / transparent with a `--muted` label                                                                                                 |
| Disabled button        | Transparent, 1px inset `--line-3`, `--faint` label (5.4:1), `aria-disabled` and a `title` saying why                                                 |
| Busy button            | `aria-busy="true"`, label becomes the verb ("Drafting", "Approving", "Building"), 14px spinner, width locked                                         |
| Copy button            | Both labels stacked in one grid cell ("Copy code" / ✓ "Copied"), so width and text position never change; announced via `aria-live`                  |
| Segmented choice       | `--nested` track, 28px options (44px on phones); selected = `--nested-2` with an ink label                                                           |
| Clarify option         | `role="radio"` card on `--card`; checked = `--nested` + 1px iris inset + iris dot; "Recommended" in iris; key hint 1/2                               |
| Status                 | 7px dot + word (`Draft` dashed ring, `Approved` ok). Never colour alone                                                                              |
| Decision band          | Card under the hero. Left: dot, one bold sentence, the why. Right: actions. States: issue → ready → approved (Undo for 10 s) / error / loading       |
| "How it's calculated"  | Right drawer, 460px (full screen on phones), `--overlay`. Tabs: Reconciliation, Definition, SQL, Sources, Checks. Scrim `rgba(0,0,0,.35)`            |
| Reconciliation ledger  | Charges, Refunds, Stripe fees, **Net revenue** (heavier rule above), then Stripe paid out and Difference, a check line, and your answers with Change |
| Setup steps (Embed)    | `<ol>` of disclosure rows (dashed ring, title, hint, right affordance); one open at a time                                                           |
| Code block             | `#0F0E0C` well; one block per line, indentation by `ch` padding; Copy builds text with 2-space indents                                               |
| Proposed / Today tags  | Small pill inside rows only: iris "Proposed", green "In this repo"                                                                                   |

## 5. Responsive rules

- **≤ 960px:** the creation stages leave the top bar; the page title carries the step.
- **≤ 720px:** the sidebar folds away; the top bar becomes 56px with the object name, the switcher mark and a menu button. Margins are 16px. Decision actions stack and fill the width. The drawer becomes a full-screen sheet. Charts stay full width at 180px tall with 12px axis labels, drawn at real pixel width (never scaled SVG text).
- Every control is at least 44px tall on phones; links inside sentences are exempt.
- One scroll per page: nothing is its own vertical scroll container. Code blocks scroll horizontally inside themselves only.

## 6. Interaction and motion

Curves: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`, `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`. Colour changes use `ease`, 120–200ms. Only `transform` and `opacity` move; disclosures animate height because nothing else can. Reviewed with Emil Kowalski's `review-animations` and approved after fixes.

| Moment                  | Trigger                                                | Motion                                                                                                                                                                                                                    | Reduced motion                |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Press                   | Any button / option                                    | `scale(.97)` (options `.99`), 160ms ease-out                                                                                                                                                                              | None                          |
| Drawer open / close     | Pointer (button or scrim)                              | `translateX(100%) → 0`, 280ms `--ease-drawer`; out 200ms ease-out along the same edge; scrim 200 / 160ms                                                                                                                  | Opacity 150ms                 |
| Drawer open / close     | Keyboard (⌘I, Enter, Esc)                              | Opacity only, 120ms                                                                                                                                                                                                       | Same                          |
| Clarify question change | Pointer                                                | New question `opacity 0 + translateX(±12px) → settled`, 220ms ease-out; +12 forward, −12 back                                                                                                                             | Opacity 120ms                 |
| Clarify question change | Keyboard (1/2/↵/Esc)                                   | Opacity only, 120ms                                                                                                                                                                                                       | Same                          |
| Use recommended         | Pointer                                                | Select, a 160ms beat, then advance                                                                                                                                                                                        | Same                          |
| Approve                 | Pointer                                                | Busy 700ms, then the decision row (lead) fades with a 4px rise in 220ms; the chart crossfades dashed grey → solid iris at +40ms over 200ms (opacity only); caption at +40ms, header status at +80ms, 160ms. Total ≤ 280ms | All together, opacity 140ms   |
| Approve                 | Keyboard (⌘↵, Enter)                                   | All together, opacity 140ms (no travel)                                                                                                                                                                                   | Same                          |
| Undo / reset            | Undo, Continue without refunds                         | All together, opacity 140ms                                                                                                                                                                                               | Same                          |
| Copy                    | Copy code / Copy                                       | Label layers crossfade 120ms; check scales `.9 → 1` in 180ms; "Copied" for 1.6 s                                                                                                                                          | No scale                      |
| Disclosure              | Technical details, setup steps, query detail, Advanced | Height + opacity, 200ms open / 140ms close, cancellable                                                                                                                                                                   | Instant height, opacity 120ms |
| Busy                    | Continue, See the result, Approve                      | Spinner, 700ms per turn                                                                                                                                                                                                   | 1.6 s per turn (status, kept) |

Not animated, deliberately: page-to-page stage transitions, chart line drawing, the figure (no count-up), list and suggestion entrances, the hero and decision containers. Every in-flight animation is cancelled before a new state starts, so Approve → Undo mid-flight is safe.

## 7. Accessibility requirements

- Visible focus everywhere: 2px iris outline with a 2px offset (the composer shows it on its container).
- Tab order follows reading order: sidebar → top bar → content → "How it's calculated". The closed drawer is `inert` and hidden; focus moves into it on open and returns to the opener on close; Esc closes.
- Tabs use `role=tablist/tab/tabpanel` with a roving tabindex and ←/→. Clarify options use `role=radiogroup/radio` with a roving tabindex; arrows move, 1/2 choose, ↵ continues, Esc goes back a question.
- Text tiers reach 4.5:1 (`--muted` 7.9:1, `--faint` 5.4:1); `--off` never carries words.
- One polite live region (`#live`) announces excluded, approved, error and copied.
- Disabled controls stay focusable, with `aria-disabled` and a reason.
- Reduced motion removes all travel and scale; fades stay at 150ms or less; status spinners slow down rather than stop.
- Status is never colour alone; charts carry an `aria-label` with the range and latest value.

## 8. Embed theming

The React Embed SDK must render with the **customer's** design, not ours. The Analyticool look is a default theme, never a requirement. Implemented in `@analyticool/react` by BRU-485; see the full contract, copyable CSS and evidence in [`../embed-theming/README.md`](../embed-theming/README.md):

- **Inherit first.** Components set `font-family: var(--ac-font, inherit)` and `color: var(--ac-ink, inherit)`, and derive tints from `currentColor`, so an unthemed embed already matches the host app. The package ships no CSS, fonts, grain or background.
- **Every colour, font and surface is a CSS custom property** with a neutral fallback: `--ac-font`, `--ac-ink`, `--ac-muted`, `--ac-line`, `--ac-grid`, `--ac-series`, `--ac-surface`, `--ac-radius` and `--ac-figure-size`. The prototype preview uses the same idea (`--h-*` per host). Focus rings are host CSS (`:focus-visible`), not a variable.
- **`className` and `style` passthrough** onto the stable root classes `ac-metric-chart` / `ac-metric-kpi`, plus documented part selectors (`[data-ac-part="caption|plot|grid|axis|series|point|details|summary|table|label|value"]`).
- **Charts read their colours from those variables**, so a host theme switch (light/dark) recolours the series without JS.
- The Darkroom B+ default appearance is copyable CSS in the docs and the `/embed-themes` example, not a package stylesheet.

**Proposed:** a `theme` prop or `theme="none"` unstyled mode. It was not added because the BRU-485 evidence did not require it; see the README. Also proposed: a shipped default-theme file and the hosted `<Metric>` API.

## 9. Prototype vs production

| Area                            | Prototype (Proposed)                                      | Repository today (`packages/*`, README)                                                 |
| ------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Embed API                       | `<Metric id view token />` fetches an approved definition | `<MetricChart result />` and `<MetricKpi result />`; the components never fetch         |
| Computation                     | Hosted engine runs queries on Stripe and Snowflake        | `calculateMonthlyRevenue(definition, { asOf, invoices })` in your server; pure, no IO   |
| Metrics                         | Any metric from natural language                          | One predefined metric: monthly collected revenue (not net of fees)                      |
| Auth                            | Server-minted token and allowed origins                   | None. The application authorizes records; fixture selection is not tenant authorization |
| Approval / versions             | Versioned definitions, Undo, "v2 needs approval"          | In-memory approval that resets on reload; not an authorization boundary                 |
| Distribution                    | `npm i @analyticool/react`                                | Private workspace packages, not published                                               |
| Views                           | Chart, KPI                                                | Chart (with an exact-value table), KPI                                                  |
| Clarify, checks, reconciliation | Generated per metric                                      | Not implemented (no LLM, no schema discovery)                                           |
| Theming                         | Customer CSS variables, `theme="none"` (§8)               | `--ac-*` variables, `className`/`style`, `data-ac-part` hooks; no `theme` prop (§8)     |

The Embed screen labels the proposed path and offers **Available today** with the real code. Keep both until the SDK ships. Hosted authentication and permissions must be designed before the `<Metric>` API is built.

## 10. Unresolved

- **Orphan refunds are not verified business logic.** Review shows 3 refunds ($412) with no matching charge and offers "Exclude them", but the figure stays $513,384 either way, because the prototype never decides which month those refunds belong to or whether they were inside October's $8,130. The real calculation must define this (and the reconciliation must change accordingly) before the flow is implemented.
- **Sample data:** the monthly series for Nov 2025–Jun 2026 (read off an earlier chart), the Recent times, the refund IDs, "last good data 09:14", `https://app.lumenlabs.io`, the workspace "Lumen Labs" and the user "Bruno S.". The October ledger reconciles by assertion in [`prototype/data.js`](prototype/data.js).
- **Visual-only controls:** workspace switcher, phone menu, "Update Stripe access", "Save origin".
- **Not built:** a light theme for the product UI.
- **Feel checks still worth doing on a real device:** the dashed-to-solid chart crossfade (40–240ms after Approve) and the drawer curve.
