# Analyticool

**Describe a metric. Verify the logic. Embed it in your app.**

Analyticool is an open-source, developer-first analytics prototype. The intended journey is **Ask → Build → Validate → Embed**: describe a business question, inspect a proposed calculation and assumptions, approve a versioned definition, and embed its results in your application.

Analyticool is a working name. This prototype implements a trusted proposal lifecycle around one metric-to-React example; it is not a production analytics service or an AI Metric Builder.

## Run locally

Requirements: **Node.js 24.21.0 LTS** and **pnpm 10.34.9**. The package manager is pinned in `package.json`; `.nvmrc` pins Node for reproducible fixture evidence.

```sh
nvm use                         # if you use nvm
corepack enable                 # if Corepack is installed
corepack prepare pnpm@10.34.9 --activate
pnpm install
pnpm dev
```

If Corepack is unavailable, install the pinned version with `npm install --global pnpm@10.34.9`. Open [localhost:3000](http://localhost:3000). No environment variables, keys, Docker, databases, or cloud accounts are needed, so there is no `.env.example` yet.

The demo is a Darkroom B+ **Studio** that walks through **Describe → Clarify → Review → Embed** ([implementation notes](docs/design/darkroom/README.md#studio-implementation-bru-488)). Type or pick one of the two supported questions, then **Continue**. Any other text is refused with a clear message: there is no AI, and the Studio never guesses a calculation. **Review** shows the latest-month figure and chart calculated by `@analyticool/core` from synthetic fixtures, labelled as a draft preview, with meaning, time basis, assumptions, evidence and checks under **How it's calculated**. **Approve metric** is a local, unauthenticated approval in this browser tab; **Add it to your app** publishes the version in this session only and shows the real `<MetricKpi result />` / `<MetricChart result />` preview and copyable React code. **Create next version** starts a v2 draft while the published v1 stays unchanged. **Start over** or reloading clears this local session.

The ambiguous example, **Show net revenue by customer**, asks what net revenue subtracts and which customer key to use. The fixtures have neither those adjustments nor a customer key, so the stub proposes no executable net-revenue definition and nothing is calculated. The reviewer must explicitly choose **Use monthly collected revenue instead** (a scope change without customer grouping) or reject with a reason. It never invents a net-revenue formula.

## Implemented

- A strict TypeScript workspace, Next.js App Router demo, and Tailwind CSS.
- A predefined `monthly-revenue` definition v1 and Zod validation of definitions, invoices, and results.
- A strict, typed `MetricProposal`, two deterministic fixture scenarios, required clarification, explicit review/approval/rejection, and immutable local publication/versioning.
- A pure calculation over synthetic SaaS payments, fixed as of **2026-07-01**, covering January–June 2026.
- A readable definition, explicit assumptions, responsive line chart, and accessible exact-value table.
- Reusable `<MetricChart result={result} />` and `<MetricKpi result={result} />` components that ship no CSS: they inherit the host font and colour and are themed with documented `--ac-*` CSS variables, `className`/`style` and `data-ac-part` hooks. `/embed-themes` renders the same synthetic result in the Analyticool default appearance and a fictional customer theme. See [embed theming](docs/design/embed-theming/README.md).
- A published metric preview and local version history using the existing React components.
- A separate deterministic operational net receipts calculator, signed results, and independently checked synthetic fixture evidence. See [its contract and replay guide](docs/architecture/operational-net-receipts.md). This new core calculation is not integrated into the demo proposal lifecycle or React components.

The six fixture values are **$2,000, $2,250, $2,490, $2,750, $3,100, and $3,420**. They represent collected revenue in USD, not MRR or accounting revenue recognition. Paid invoices are grouped by payment timestamp in UTC. Open, void, and refunded invoices are excluded entirely, as is the current partial month. Integer cents avoid floating-point accumulation. Missing months become zero; duplicate invoice IDs and unsafe monthly totals are rejected. Annual invoices are not prorated and currencies are not converted.

## Architecture

| Location         | Responsibility                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`  | Metric/proposal/invoice contracts, fixture catalog/stub, lifecycle, immutable publication, pure calculation, tests. No React or IO. |
| `packages/react` | Stateless KPI and SVG chart with an exact-value table. Accepts results; never fetches. No Tailwind requirement.                     |
| `apps/demo`      | Synthetic fixtures, fixed workspace selection, local proposal review/publication, and calculated preview.                           |

Definition, execution, and presentation stay separate. Calculations take explicit inputs and never read the clock. The app supplies collected-revenue results to React; there is no metric-name resolver or hidden execution provider. Core also supports bounded operational net receipts with its own result contract, without a generic connector or plugin framework.

### Proposal trust and lifecycle

`generateMetricProposal(request, proposalId)` returns a **draft**, not an approval. `createMetricProposal(unknown)` is the trust boundary for future generated JSON: Zod rejects missing data, extra fields, unsupported expressions, and relationships. The existing calculation identifier specifies summation, paid-only filtering, and payment-month grouping; currency, UTC, and the six-complete-month window remain explicit. Bindings identify the dataset, table, and each required field. There is no SQL or second expression language.

`validateProposalDefinition(unknown)` returns structural/semantic issues against the trusted synthetic catalog, including unknown source/field references, fields used in the wrong roles, and invalid evidence references. It **does not prove numerical correctness**. The deterministic executor independently validates invoice inputs and result invariants; fixture tests verify exact amounts.

- `submitMetricProposal(draft)` checks references and the supported definition, producing `ready_for_review`; unresolved required questions instead produce `needs_clarification`.
- `resolveMetricClarification(...)` accepts only the explicit supported fallback decision and returns a draft. Submission and review must happen again.
- `editMetricProposal(...)` accepts replacement proposal content before approval and returns a draft, invalidating readiness.
- `approveMetricProposal(ready, { reviewer })` records an explicit review. `rejectMetricProposal(...)` requires a reason and is terminal.
- `publishMetricProposal(approved)` returns an immutable `PublishedMetricVersion` with the exact reviewed executable definition. Repeated publication of that approved snapshot returns the same version.
- `reviseMetricVersion(published, newProposalId)` starts a fresh draft at the next version, clears approval, and leaves the old publication intact. A local publication can have only one successor; a rejected successor remains terminal in this minimal session model.

All lifecycle snapshots are recursively frozen and have readonly TypeScript types. Transitions consume the current snapshot; stale snapshots, copied objects, and parsed status fields cannot grant review or publication authority. This uses process-local object identity, not a database or workflow engine. Parsing exported JSON validates its shape but cannot restore lifecycle authority across serialization, browser/server boundaries, or reloads. A future persistence design must explicitly re-establish trusted state and version uniqueness. Independent new proposals are separate local lineages, not a global metric registry.

The original `MonthlyRevenueDefinition` and its v1 schema remain unchanged. The additive `VersionedMonthlyRevenueDefinition` contract accepts positive integer versions of the same supported calculation; the executor and result components accept those revisions. Changes to supported calculation semantics require an intentional contract extension. Approval/publication does not authorize data access, and the existing calculation API remains usable independently of the demo lifecycle.

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

Both components validate results at runtime, accept `className` and `style`, read `--ac-*` CSS variables, and work with React 19. Formatting uses an explicit locale and UTC. The chart has an SVG and an expandable exact-value table.

## Current boundaries

The two questions are predefined. **No LLM is called**, no schema discovery occurs, and no generated SQL is executed. The demo calculates local synthetic fixtures after publication; there is no hosted execution service or public execution API.

Fixtures contain two fictional workspaces. The demo selects one fixed workspace in application code, never from client input, before passing rows to core. This is fixture selection, **not tenant authorization**. Core assumes callers already authorized their records. Real database connections require a server-enforced security design.

Published definitions and their proposal/review snapshots have immutable local version history, but no global registry, durable storage, or audit log. Approval is process-local state and resets on reload; it is not an authorization boundary. Presentation components do not enforce approval. Natural-language generation, net revenue by customer, PostgreSQL and other connectors, CSV/Excel import, RAG, MCP, authentication, billing, and hosted infrastructure remain future work. The separate net receipts fixture checks local arithmetic and scope policy; production data, source completeness/freshness and real tenant isolation have not been verified.

## Quality checks

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm verify:net-receipts        # replay and check the committed synthetic evidence
python3 verification/net-receipts/oracle.py  # independent baseline arithmetic
pnpm build
pnpm start                     # serve the production build
```

GitHub Actions runs a frozen install, all five checks, net receipts evidence replay and the independent Python oracle. Tests cover proposal schemas, references, clarification, explicit transitions, forged/stale states, rejection, immutability/versioning, executor compatibility, UTC boundaries and offsets, leap day, year rollover, integer arithmetic, exclusion rules, empty months, duplicates, overflow, fixture selection, and server-rendered components. Net receipts adds independent component/total assertions, explicit blocked cases and deliberately incorrect variants that must fail. **Synthetic fixture checks passed. Production data has not been verified.**

For the optional browser smoke test, run `pnpm exec playwright install chromium`, then `pnpm build && pnpm test:smoke`. It starts and stops a local production server on port 3100 and checks generation, clarification, keyboard approval, publication, version history, rejection, reset/reload, and mobile overflow. `tests/smoke/embed-themes.spec.ts` checks `/embed-themes`: theme variables, font inheritance, no CSS leakage, focus, contrast, tooltips, reduced motion, 390px overflow and hydration. It also writes the screenshots in `docs/design/embed-theming/screenshots/`. This browser check is separate from the lightweight CI baseline.

TypeScript 5.9 and ESLint 9 are retained for compatibility with the current TypeScript-ESLint and Next.js lint-plugin peer ranges. The lockfile pins the complete dependency graph.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Use only synthetic data. Maintainers should enable private vulnerability reporting, secret scanning/push protection, and default-branch protection with required CI checks; this bootstrap does not configure repository settings.

## Planning and next step

The [BRU-470 bootstrap](https://linear.app/brunosimplicio/issue/BRU-470) is extended by [BRU-460 trusted proposals, approval, and versioning](https://linear.app/brunosimplicio/issue/BRU-460). Visual exploration is separate in [BRU-456](https://linear.app/brunosimplicio/issue/BRU-456); final identity and founder-provided HTML references are deferred. Real data access is gated on [BRU-461](https://linear.app/brunosimplicio/issue/BRU-461), covering secure PostgreSQL connections and tenant boundaries. Planning links may require workspace access; this README is sufficient to run and contribute.

## License

Copyright 2026 Analyticool contributors. Licensed under [Apache-2.0](LICENSE). The initial repository had no license, so none was replaced. Apache-2.0 allows permissive reuse, including commercial use, and includes an explicit contributor patent grant. See the [official license](https://www.apache.org/licenses/LICENSE-2.0) for redistribution and attribution conditions. Dependencies retain their own licenses.
