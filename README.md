# Analyticool

**Describe a metric. Verify the logic. Embed it in your app.**

Analyticool is an open-source, developer-first analytics prototype. The intended journey is **Ask → Build → Validate → Embed**: describe a business question, inspect a proposed calculation and assumptions, approve a versioned definition, and embed its results in your application.

Analyticool is a working name. This bootstrap implements one metric-to-React example; it is not a production analytics service or an AI Metric Builder.

## Run locally

Requirements: **Node.js 24 LTS** and **pnpm 10.34.9**. The package manager is pinned in `package.json`; `.nvmrc` selects Node 24.

```sh
nvm use                         # if you use nvm
corepack enable                 # if Corepack is installed
corepack prepare pnpm@10.34.9 --activate
pnpm install
pnpm dev
```

If Corepack is unavailable, install the pinned version with `npm install --global pnpm@10.34.9`. Open [localhost:3000](http://localhost:3000). No environment variables, keys, Docker, databases, or cloud accounts are needed, so there is no `.env.example` yet.

Inspect the definition and assumptions, expand **View exact values**, then select **Approve demo metric**. A dashboard renders a KPI and chart using the same result. **Reset demo approval** hides it; reloading also resets approval.

## Implemented

- A strict TypeScript workspace, Next.js App Router demo, and Tailwind CSS.
- A predefined `monthly-revenue` definition v1 and Zod validation of definitions, invoices, and results.
- A pure calculation over synthetic SaaS payments, fixed as of **2026-07-01**, covering January–June 2026.
- A readable definition, explicit assumptions, responsive line chart, and accessible exact-value table.
- Reusable `<MetricChart result={result} />` and `<MetricKpi result={result} />` components.
- A local review/approval interaction that reveals the dashboard embed.

The six fixture values are **$2,000, $2,250, $2,490, $2,750, $3,100, and $3,420**. They represent collected revenue in USD, not MRR or accounting revenue recognition. Paid invoices are grouped by payment timestamp in UTC. Open, void, and refunded invoices are excluded entirely, as is the current partial month. Integer cents avoid floating-point accumulation. Missing months become zero; duplicate invoice IDs and unsafe monthly totals are rejected. Annual invoices are not prorated and currencies are not converted.

## Architecture

| Location         | Responsibility                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/core`  | Metric/invoice contracts, runtime validation, definition v1, pure calculation, tests. No React or IO.           |
| `packages/react` | Stateless KPI and SVG chart with an exact-value table. Accepts results; never fetches. No Tailwind requirement. |
| `apps/demo`      | Synthetic fixtures, fixed workspace selection, server-rendered calculation, client-side review/approval.        |

Definition, execution, and presentation stay separate. The calculation takes explicit inputs and never reads the clock. The app supplies results to React; there is no metric-name resolver or hidden execution provider. There is one supported calculation, without a generic connector or plugin framework.

Workspace packages expose TypeScript source, transpiled by Next.js. All packages are private and **not published SDKs**. A future npm release needs package output and compatibility checks.

### Calculate and embed

```tsx
import {
  calculateMonthlyRevenue,
  monthlyRevenueDefinition,
  type MonthlyRevenueResult,
} from "@analyticool/core";
import { MetricChart, MetricKpi } from "@analyticool/react";

// In your application's data layer, using authorized records:
const result = calculateMonthlyRevenue(monthlyRevenueDefinition, {
  asOf: "2026-07-01",
  invoices: [
    {
      id: "synthetic-1",
      amountCents: 12_500,
      currency: "USD",
      status: "paid",
      paidAt: "2026-06-10T12:00:00Z",
    },
  ],
});

// Render after your application has approved the definition/result.
function RevenueDashboard({ result }: { result: MonthlyRevenueResult }) {
  return (
    <section aria-label="Revenue dashboard">
      <MetricKpi result={result} />
      <MetricChart result={result} />
    </section>
  );
}

// <RevenueDashboard result={result} />
```

Both components validate results at runtime, support `className`, and work with React 19. Formatting uses an explicit locale and UTC. The chart has an SVG and an expandable exact-value table.

## Current boundaries

The question is predefined. **No LLM is called**, no schema discovery occurs, and no generated SQL is executed. The Next.js page calculates local fixtures; there is no hosted execution service or public execution API.

Fixtures contain two fictional workspaces. The demo selects one fixed workspace in application code, never from client input, before passing rows to core. This is fixture selection, **not tenant authorization**. Core assumes callers already authorized their records. Real database connections require a server-enforced security design.

The definition has a version, but no registry, durable version history, or audit log. Approval is in-memory UI state and resets on reload; it is not an authorization boundary. Presentation components do not enforce approval. Natural-language generation, PostgreSQL and other connectors, CSV/Excel import, RAG, MCP, authentication, billing, and hosted infrastructure remain future work.

## Quality checks

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm start                     # serve the production build
```

GitHub Actions runs a frozen install and all five checks. Tests cover contracts, UTC boundaries and offsets, leap day, year rollover, integer arithmetic, exclusion rules, empty months, duplicates, overflow, fixture selection, and server-rendered components.

For the optional browser smoke test, run `pnpm exec playwright install chromium`, then `pnpm build && pnpm test:smoke`. It starts and stops a local production server on port 3100 and checks review, keyboard approval, reset, reload, and mobile overflow. This browser check is separate from the lightweight CI baseline.

TypeScript 5.9 and ESLint 9 are retained for compatibility with the current TypeScript-ESLint and Next.js lint-plugin peer ranges. The lockfile pins the complete dependency graph.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Use only synthetic data. Maintainers should enable private vulnerability reporting, secret scanning/push protection, and default-branch protection with required CI checks; this bootstrap does not configure repository settings.

## Planning and next step

Scope: [BRU-470](https://linear.app/brunosimplicio/issue/BRU-470). Visual exploration is separate in [BRU-456](https://linear.app/brunosimplicio/issue/BRU-456); final identity and founder-provided HTML references are deferred. Real data access is gated on [BRU-461](https://linear.app/brunosimplicio/issue/BRU-461), covering secure PostgreSQL connections and tenant boundaries. Planning links may require workspace access; this README is sufficient to run and contribute.

The next smallest AI Metric Builder task is a **draft-only proposal contract**: define and test a proposal referencing an allowed field, aggregation, time window, and assumptions. Reject invalid proposals and block execution until review. Exercise this with a local stub before adding a model or real database.

## License

Copyright 2026 Analyticool contributors. Licensed under [Apache-2.0](LICENSE). The initial repository had no license, so none was replaced. Apache-2.0 allows permissive reuse, including commercial use, and includes an explicit contributor patent grant. See the [official license](https://www.apache.org/licenses/LICENSE-2.0) for redistribution and attribution conditions. Dependencies retain their own licenses.
