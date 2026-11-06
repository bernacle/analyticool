# BRU-482 — Quill vs. Analyticool: time to a verified embed

Research date: **2026-11-06**. Recommendation: **narrow our scope**.

## Executive summary

Quill is a serious overlap, not merely an iframe dashboard vendor. Its public documentation and published packages support AI/SQL report creation, reusable virtual tables, headless React APIs, extensive customization, server-side tenant parameters, and environment promotion. “AI analytics + React + your CSS” is insufficient differentiation. [Q4], [Q7], [Q9], [Q12]

A credible smaller problem is **shipping a few customer-facing SaaS metrics whose meaning, exact results, and approved version a developer can defend**. Analyticool has useful foundations for this, but no demonstrated competitive win yet. It cannot complete the requested PostgreSQL net-revenue journey today. Quill could plausibly implement the same workflow using its existing primitives; its absence from the inspected public material is an opportunity to test, not proof of a missing capability.

The most promising hypotheses are (1) fixture-backed approval, (2) portable, version-pinned definitions and evidence, and (3) a deliberately small, CSS-native integration for fixed metrics. Validate these with working integrations and five developers before broadening into self-service BI, arbitrary SQL generation, or a general semantic platform.

**No comparative integration timing was obtained.** Quill onboarding redirected to authentication; no account, subscription, or database was created. Analyticool's current tests, collected-revenue lifecycle, fixture projection, and server rendering worked locally. A separate standard-library oracle verified synthetic net-revenue arithmetic; neither product executed that net-revenue calculation. A sub-15-minute trustworthy embed remains an unproven target.

## Evidence standard and scope

| Label   | Meaning                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------ |
| **W**   | Executed successfully here; scope stated explicitly.                                                         |
| **D/S** | Verified in primary documentation or inspected source/package code; runtime behavior untested unless also W. |
| **M**   | Marketing assertion or illustrated interaction; not a working integration.                                   |
| **U**   | Unknown, inaccessible, or not tested. Absence of evidence is not evidence of absence.                        |

Quill sources include the current documentation index, official examples, and downloaded npm artifacts: `@quillsql/react@2.16.110`, `@quillsql/node@0.9.27`, `@quillsql/cli@0.1.0`. Artifacts were inspected in a temporary directory, without installing them into Analyticool or executing their SaaS calls. Legacy `docs.quillsql.com` redirects to `quill.co/docs/architecture`; the current index is the discovery starting point. [Q2], [Q10], [Q11], [Q12]

Analyticool baseline: commit [`075ff87`](https://github.com/bernacle/analyticool/tree/075ff87fd0d83231cfa412f45d1b142f33e5f0d3). GitHub confirms [PR #2](https://github.com/bernacle/analyticool/pull/2) merged **2026-11-04 22:06:25 UTC** and [PR #3](https://github.com/bernacle/analyticool/pull/3) merged **22:03:29 UTC**. Both are ancestors of this checkout. PR #3 delivers a design specification and static prototype, not the proposed production implementation. [A5]

## Verified competitor capabilities

| Question                             | Finding and evidence strength                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Create a metric?**              | **D/S:** Quill's public unit is a report: connect a source/schema, create a dashboard, author a query with SQL or ReportBuilder, run/inspect it, configure its chart, and save it. A SQL virtual table can centralize reusable calculations. This differs from a separately approved typed metric artifact. [Q3], [Q4], [Q5]                                                                                                                                                                                                                                                                                                                |
| **2. Natural language?**             | **D/S:** ReportBuilder and SQLEditor document AI creation and editing against available schemas. Published React declarations include `useReport`, `setReport`, and `saveChanges`. **U:** accuracy on our prompt, conversational clarification behavior, and Agent API execution. [Q4], [Q10]                                                                                                                                                                                                                                                                                                                                               |
| **3. Ambiguity?**                    | **D:** users inspect results and revise SQL or ask AI to fix a query. **M:** named business fields and descriptions provide agent context. **U:** whether Quill asks collected vs. net, refund attribution, fee policy, and timezone before execution; no mandatory clarification protocol was found. [Q1], [Q4], [Q13]                                                                                                                                                                                                                                                                                                                     |
| **4. Numerical correctness?**        | **M:** schema/AST validation and correction are advertised. **D/S:** SQL/query validation exists in CLI code; docs ask users to inspect returned data. **U:** independent expected-value assertions, refund reconciliation, fan-out guarantees, or correctness-gated publication. Syntactically valid SQL can still implement the wrong business rule. [Q1], [Q4], [Q12]                                                                                                                                                                                                                                                                    |
| **5. Semantic layer?**               | **D:** reusable SQL virtual tables are documented. **M:** the newer semantic-layer page adds named measures/dimensions, descriptions, and inherited tenant boundaries. Do not describe Quill as lacking semantics. **U:** full runtime behavior of these newer claims. [Q5], [Q13]                                                                                                                                                                                                                                                                                                                                                          |
| **6. Inspect calculations/sources?** | **D:** SQL editor, query response table, visible schema, and editable virtual-table SQL. **M:** AI report UI shows source names, filters, and exact query. **U:** complete execution lineage, source snapshot/freshness evidence, or an immutable result-to-definition audit trail. [Q4], [Q5], [Q14]                                                                                                                                                                                                                                                                                                                                       |
| **7. Explicit approval/versioning?** | **D/S:** development/production environments and entity-level promotion; CLI sandbox creation, confirmation flag, change formatting, and an official GitHub Action. This is meaningful release control. **U:** mandatory named reviewer approval, fixture evidence bound to approval, immutable metric versions, rollback guarantees, and pinning an embed to an approved version. Saving/promoting is not proof of those properties. [Q6], [Q11], [Q12]                                                                                                                                                                                    |
| **8. React SDK?**                    | **D/S:** `QuillProvider` configures public identity, cloud tenants or a custom query endpoint, headers/credentials, and theme. `Dashboard`, `Chart`, hooks, and `StaticChart` are exported; React 18/19 peers are declared. Published types include both older `useDashboardReport` and newer `useReport`. **U:** a completed Next.js integration here. [Q7], [Q8], [Q9], [Q10]                                                                                                                                                                                                                                                             |
| **9. Customization?**                | **D/S:** theme fields cover typography, surfaces, text, chart colors/ticks and borders; custom component props and headless hooks allow host UI. `StaticChart` has `className`/container-style options. **U:** effort to restyle every state with CSS alone. Quill already supports more customization than our current SDK. [Q8], [Q9], [Q10]                                                                                                                                                                                                                                                                                              |
| **10. Auth/multi-tenancy?**          | **D/S:** server SDK accepts tenant field/IDs; the official sample derives them server-side from a mock authenticated organization. Docs also describe row, schema, and database divisions and dashboard owner/viewer roles. **U:** adversarial isolation across joins, caches, exports, streams, and forged metadata. Client tenant IDs are not independently an authorization proof. [Q7], [Q11], [Q15], [Q16]                                                                                                                                                                                                                             |
| **11. Working chart prerequisites?** | **D/S:** account/environment and keys, source access, tenant/schema configuration, saved report/dashboard, SDK installation, provider, component; hybrid hosting additionally needs an authenticated backend endpoint. The official runnable sample requires PostgreSQL seed data and Quill keys. **U:** successful chart execution or elapsed setup time in this research. [Q3], [Q7], [Q11], [Q16]                                                                                                                                                                                                                                        |
| **12. Price/hosting/OSS?**           | **D/S:** cloud, hybrid, and self-hosted BI deployment are documented; even the documented self-hosted architecture calls a Quill metadata API. Node defaults to `api.quill.co` and permits a metadata URL override. Node package declares ISC, CLI includes MIT; inspected React package has no license field/file. Public example repos are not evidence that the complete platform is open source. **U:** current price, trial limits, quotas, tenant/AI/export charges, self-host entitlements, full engine source/license, and supported disconnected operation. No current price schedule was located. [Q1], [Q2], [Q11], [Q12], [Q17] |

### Developer-onboarding observations

- **W, access only:** opening `https://app.quill.co/onboard` in a fresh incognito browser redirected to `https://accounts.quill.co/sign-in?redirect_url=https%3A%2F%2Fapp.quill.co%2Fonboard`. The sign-in document did not yield a usable form in this automation session. No credentials were entered and no account was created. This demonstrates an access limit, not a broken product.
- **D/S:** the official `demo` repo is Vite/React/Express, seeds organizations/orders, requires keys, and uses a fixed mock organization in server middleware. It is neither a production auth implementation nor our refunds/fees scenario. The Next.js self-hosted example is an **internal admin** example with cross-tenant/admin flags; copying its route into a customer-facing app would misapply its stated boundary. [Q11], [Q16]
- **W, page inspection:** `/pricing` displayed the homepage content in the inspected session, with no prices; the main CTA leads to a sales meeting. Do not infer that Quill is expensive, has no free trial, or charges per tenant. Obtain an actual quote before making cost comparisons. [Q1], [Q17]
- **D/S:** docs are broad but require reconciliation with package versions. The Node quickstart's object literal is missing a comma after `tenants`; its environment-variable spelling also differs from the official sample. The older StaticChart guide passes report data while current declarations require `reportId`. Treat snippets as version-sensitive, not proof that the whole SDK is unusable. [Q7], [Q10], [Q18]

## Feature and developer-experience comparison

| Dimension                 | Quill, evidence available                                                                                                                 | Analyticool, current implementation                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time to trustworthy embed | **U:** blocked at account access; quickstart minute claims exclude semantic verification.                                                 | **W:** collected fixture → lifecycle → SSR works; no full net/Postgres timing.                                                                                                     |
| Steps/configuration       | Documented integrated path below: eight checkpoints; keys, schema/tenant model, report/dashboard, provider, endpoint/session integration. | Six checkpoints for the existing local demo; target net journey blocks at unsupported definition/source. Zero keys is a synthetic-demo property.                                   |
| SQL knowledge             | AI/no-code reports available; authoring complex virtual tables and auditing financial SQL still needs expertise.                          | None for the single built-in calculation; arbitrary questions and financial joins are unsupported.                                                                                 |
| Definition/approval       | Reusable SQL and promotion supported; stronger metric approval guarantees unknown.                                                        | Typed proposal, clarification, explicit review, immutable local publication/revision. No durable or authenticated reviewer authority.                                              |
| Traceability/verification | Query/source inspection documented; independent numeric oracle unknown.                                                                   | Pure integer-cent executor, explicit assumptions, exact-value table and tests; evidence references describe fixture fields, not a general proof system.                            |
| React ergonomics          | Provider plus components/hooks; broader reporting/editor/export surface.                                                                  | `MetricChart result={result}` / `MetricKpi result={result}`; never fetch. No metric-ID resolver, token API, public npm SDK, or generic MetricTable.                                |
| Host CSS                  | Headless host UI, themes, component replacement, chart class/style options.                                                               | `className` only; inline colors/sizes and SVG strokes impede ordinary CSS overrides. No public tokens/slots/`style` prop. B+ embed theming is a specification.                     |
| Multi-tenant security     | Backend-scoped tenant API and examples; runtime security untested here.                                                                   | Fixed fixture selection; core assumes already-authorized rows. Neither approval nor components enforce data access.                                                                |
| Documentation             | Substantial onboarding/API/examples, with version inconsistencies and unknown commercial terms.                                           | Honest, reproducible README and design boundary labels; no real PostgreSQL/Next.js customer quickstart or deployment guide.                                                        |
| Self-hosting/OSS          | Local DB execution supported; metadata dependency documented; licenses vary by artifact.                                                  | Apache-2.0 core/demo/React source, no runtime cloud calls in this example. Not a complete self-hosted analytics service.                                                           |
| Solo-developer complexity | More setup and concepts, but buys working reporting primitives we would otherwise build.                                                  | Small local surface; real integration currently pushes source loading, security, persistence, and semantics onto the developer. Fewer controls is not evidence of less total work. |

### Journey, integration steps, and timings

A checkpoint is a meaningful developer action, not a click or LOC count. Counts below are **workflow inventories**, not measured usability results; scope differs and the counts do not establish speed.

| Path                                  | Checkpoints                                                                                                                                                                                                | Observed completion                                                                                                                                                                 | End-to-end elapsed time                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Quill hybrid target (**theoretical**) | 1 account/keys; 2 read-only source; 3 tenant/schema/virtual table; 4 define/clarify report; 5 independent numeric/tenant checks; 6 review/promote; 7 authenticated query endpoint; 8 provider/chart/theme. | Access attempt only. Stages 2–8 **not tested**; mandatory review guarantees unknown.                                                                                                | **Not measured**; neither a pass nor a timed failure.          |
| Analyticool existing demo             | 1 install/run; 2 choose built-in question/generate; 3 inspect; 4 submit; 5 approve/publish; 6 render supplied result.                                                                                      | Source/lifecycle/SSR verified; no interactive browser completion measured.                                                                                                          | **Not measured**; local test duration is not integration time. |
| Analyticool target net workflow       | Same source → define/clarify → verify → approve → React/CSS job.                                                                                                                                           | Literal prompt rejected; built-in ambiguous example blocks until a **collected-revenue fallback**, changing the requested metric. PostgreSQL, net execution and tenant auth absent. | **Not completable on current implementation**.                 |

A working chart is not the finish line. A trustworthy embed requires agreed semantics, exact expected values, isolation checks, an identified approved definition, the host integration, and a usable customer theme. For a future benchmark, start the clock at the quickstart on a prepared synthetic SaaS checkout with working session auth and PostgreSQL; stop after all those conditions pass. Separately report account wait, dependency install, active coding, debugging, and blocked stages. Do not omit setup time to hit 15 minutes.

## Reproducible integration findings

### Scenario and metric contract

Target host: Next.js App Router plus PostgreSQL tables `organizations`, `users`, `charges`, `payments`, `refunds`, `processing_fees`. Charges belong to a user and organization; payments reference charges; adjustments reference payments **and the same organization**. This bounded fixture has one full payment attempt per charge, partial refunds and multiple fees; split payments, multiple currencies and fee reversals are outside it.

Prompt: **“Show me monthly net revenue for the last six months.”** Before execution, the developer must choose:

1. **Meaning:** collected cash, or collected cash less settled refunds and processing fees? For this experiment select the latter and label it operational net receipts, not accounting revenue recognition or processor payouts.
2. **Attribution:** subtract each settled refund in its settlement month and each settled fee in its posting month, including refunds of older payments. Do not retroactively erase a payment because it was later refunded. Pending/failed items do not count; no tax/FX/proration policy is implied.
3. **Period/timezone:** freeze `asOf=2026-07-01`, use six complete **UTC** calendar months `[2026-01-01T00:00Z, 2026-07-01T00:00Z)`, zero-fill months. This is a fixture date, not today's reporting period. Select another timezone explicitly in a later experiment.
4. **Tenant:** resolve `organization_id=acme` from the server session. Apply it independently to every fact source and verify parent ownership. Never accept an unrestricted organization ID from the browser. No product tenant-security test was completed here.

The intended SQL shape is independently scoped fact streams combined with `UNION ALL` (payments positive, refunds/fees negative), aggregated by UTC month and left-joined to a six-month calendar. Keep `organization_id` through the reusable virtual table, or enforce equivalent server scope before aggregation. Do not join raw refunds and fees to payments before summing: `p1` has two refunds and two fee rows, which would repeat its payment four times. Do not filter all facts by payment month: the January refund belongs to a December payment.

This SQL shape is a **review plan, not SQL executed against PostgreSQL or Quill**. Any future connector must demonstrate tenant-filter placement, read-only permissions, parameter binding, timeout/cost controls and identical oracle results. No database or connector was introduced by this research.

### Exact fixture oracle (W: independent arithmetic only)

The executable Python appendix defines every row and checks a separate handwritten expected vector. It uses standard-library integer arithmetic and timestamp conversion, not either product's calculator.

| UTC month | Captured cents | Settled refunds | Posted fees |  Net cents |
| --------- | -------------: | --------------: | ----------: | ---------: |
| Jan 2026  |         10,000 |           3,000 |         350 |  **6,650** |
| Feb 2026  |         20,000 |           1,500 |         600 | **17,900** |
| Mar 2026  |              0 |           2,000 |           0 | **−2,000** |
| Apr 2026  |              0 |               0 |           0 |      **0** |
| May 2026  |              0 |               0 |           0 |      **0** |
| Jun 2026  |         30,000 |               0 |         900 | **29,100** |
| Total     |         60,000 |           6,500 |       1,850 | **51,650** |

The fixture includes unpaid/failed charges, pending refunds, July exclusion, a January timestamp that becomes February in UTC, an old-payment refund, multiple users in one organization, and a large second tenant. Reversing adjustment order preserves results; an injected cross-tenant adjustment is rejected by the oracle. These checks validate **this oracle**, not Quill isolation or a future SQL query.

**W: Analyticool's supported subset.** Projecting captured Acme payments to its current invoice input produced `[10000, 20000, 0, 0, 0, 30000]` cents, matching the independently expected collected vector. Proposal → review → approval → publication and React static rendering succeeded. This projection deliberately leaves payments marked paid and does not model refunds in the invoice status: it verifies collected cash only. It is not an implemented data adapter or a net-revenue integration.

**W: failure boundaries.** The exact requested prompt throws `Unsupported fixture request`. The existing “Show net revenue by customer” example enters `needs_clarification` with no definition and cannot be approved; its only supported resolution changes scope to monthly collected revenue. Injecting the oracle's net vector fails the result schema because March is negative. A future net metric needs an intentional contract/executor extension, not just a different label. [A2], [A3]

### Two integration snippets

**Quill — documentation/source-based adaptation, NOT executed.** This is the small client surface after source, report and authenticated endpoint setup. `POST /api/quill` must derive tenant IDs from the host session and call `quill.query({ tenants, metadata })`; the official sample illustrates that shape with mock auth. The chart report ID is a placeholder. No approval/version guarantee is implied. [Q7], [Q10], [Q16]

```tsx
"use client";
import { Chart, QuillProvider } from "@quillsql/react";

export function Revenue() {
  return (
    <QuillProvider
      publicKey="YOUR_ENVIRONMENT_PUBLIC_KEY"
      queryEndpoint="/api/quill"
      withCredentials
    >
      <section className="customer-revenue">
        <Chart reportId="YOUR_VERIFIED_REPORT_ID" />
      </section>
    </QuillProvider>
  );
}
```

Host CSS controls the section; complete Quill styling may use a provider theme, custom components or headless rendering. We did not verify CSS-only customization of all chart states.

**Analyticool — current API, exercised through the replay below.** A server/data layer supplies already-authorized invoice rows. The UI can be a server component; no provider or hidden fetch is required. This is **collected revenue**, not the requested net metric. Packages are private workspace source, not installable published SDKs. [A2], [A3], [A4]

```tsx
import {
  calculateMonthlyRevenue,
  type Invoice,
  type PublishedMetricVersion,
} from "@analyticool/core";
import { MetricChart } from "@analyticool/react";

// publication comes from explicit review actions, as in the replay below.
export function CollectedRevenue({
  publication,
  invoices,
}: {
  publication: PublishedMetricVersion;
  invoices: Invoice[];
}) {
  const result = calculateMonthlyRevenue(publication.definition, {
    asOf: "2026-07-01",
    invoices,
  });
  return <MetricChart result={result} className="customer-revenue" />;
}
```

Passing a publication here is an application convention, not an enforced execution gate: the calculator and component also accept inputs without approval. Publication authority cannot be restored by parsing serialized JSON. Root `className` is real, but hardcoded inline colors and SVG strokes mean `.customer-revenue { color: ... }` cannot fully theme the current chart. No browser restyling or hydration test was performed here. [A3], [A4]

## Analyticool strengths and weaknesses

**Strengths:** small pure executor; integer cents; fixed clock input; rejected duplicates/unsafe totals; explicit supported semantics; strict proposal input boundary; blocked unresolved clarification; frozen local version snapshots; exact-value table; no vendor runtime dependency for the implemented path. These are inspectable and tested, not merely B+ screenshots. [A1], [A2], [A3], [A4]

**Weaknesses:** only two hardcoded prompts and one executable metric; no SQL, live PostgreSQL source, general semantic layer, net/refund/fee executor, signed negative results, persistent registry, authenticated approval, tenant enforcement, public SDK release, or proven CSS contract. Approval is process-local object identity and does not survive serialization/reload. Structural proposal validation does not independently verify arithmetic. “AI-native” currently describes the intended workflow, not a working AI builder. The B+ reconciliation drawer, orphan-refund logic, hosted token embed and broad styling contract are proposed; PR #3 merging does not make them functional. [A1], [A2], [A3], [A4], [A5]

The default fixture excludes refunded invoices entirely. That policy is explicit, but cannot be reused as cash receipts less refunds: it loses original payment timing and partial-adjustment history. Production trust also requires freshness, schema-change behavior, error handling and tenant tests that our local fixtures do not establish.

## Kaelio: limited lessons for BRU-484

Inspected at [`49a4ae6`](https://github.com/Kaelio/ktx/tree/49a4ae6f5b28c904da921afc0ee72da6db7ac202); **D/S only, no installation or warehouse execution**. This is context research, not a second architecture proposal.

| Area                  | Observed approach                                                                                                                                                                                               | Bounded idea to explore                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reusable definitions  | YAML sources declare grain, joins/cardinality, measures and segments; semantic requests compile through a deterministic planner. Docs describe per-source aggregation to mitigate fan-out.                      | Make grain and adjustment attribution explicit before allowing financial joins. Do not build a general join compiler in BRU-482. [K1], [K2]                                                       |
| Git-versioned metrics | README recommends committing `ktx.yaml`, `semantic-layer/` and `wiki/`, keeping `.ktx/` state/secrets local.                                                                                                    | Export a small metric definition plus fixture/evidence for normal Git review. Git history alone is not an authenticated approval or an immutable execution pin. [K1]                              |
| Business context      | Wiki holds business language and caveats; structured YAML drives compilation. The agent reads wiki; the compiler does not read it at compile time.                                                              | Separate explanatory business context from executable approved definitions. Context must not silently change a published metric. [K2]                                                             |
| Validation/execution  | `sl_validate` checks model references/grain/join consistency; source has read-only/single-statement checks with a parser-backed canonical gate described in comments. Database execution is a separate concern. | Keep structural validation, numerical evidence and data-access authorization distinct. Read-only execution still needs tenant scope and resource limits. No claim of a security audit. [K3], [K4] |

Defer connectors, ingestion, MCP, retrieval, auto-maintenance and full planner evaluation to [BRU-484](https://linear.app/brunosimplicio/issue/BRU-484).

## Three potential competitive advantages

These are falsifiable hypotheses, not current product claims. Complexity is relative engineering scope, not a delivery estimate.

| Hypothesis                                                              | Developer problem / why Quill may leave room                                                                                                                                                                                                             | Required Analyticool work                                                                                                                                                                                                                                                             | Measurement and disproof                                                                                                                                                                                                                                                                                                                                                  | Complexity / risks                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Fixture-backed approval for a few financial metrics**              | A chart can be plausible yet wrong about refund months, fees or join grain. Quill shows query validation/inspection, but we found no required independent expected-value gate. Its existing platform could add one.                                      | One bounded net-receipts contract; signed amounts; independent expected fixtures; component reconciliation; fail-closed unsupported semantics; bind approval to exact definition and verification evidence.                                                                           | Five developers run this fixture plus seeded wrong-refund-month, fan-out and timezone variants. Target: all wrong variants blocked, 4/5 correctly explain the approved answer, zero unexplained cent differences. Benchmark against accessible Quill and hand SQL. Disprove if users obtain equivalent evidence faster there or do not value the gate.                    | **Medium–high.** Accounting-policy sprawl, misleading green badges, and stale evidence. Fixture success never proves all production rows.                                                                |
| **2. Portable, version-pinned metric and evidence under app ownership** | Teams want reviews and reproducible deployments without a reporting control-plane dependency. Quill has promotion and CI already; the documented metadata dependency leaves a narrower portability opportunity.                                          | Export/import a reviewable artifact with source bindings, semantic version/content identity, fixture digest and evidence; deterministic local execution; explicit trusted reapproval after import; version pinning. Prefer app-owned files/Git before building hosted infrastructure. | From a clean checkout, reproduce exact results with no Quill/Analyticool cloud call; preserve v1 while revising v2; reject stale/mismatched evidence. Have 4/5 developers reproduce and review a version change. Disprove if Quill provides equivalent portable execution or teams prefer managed reporting enough to outweigh this benefit.                              | **Medium** for bounded file artifacts; **high** for durable multi-user approval. Migration, serialization authority, freshness and version identity need care. OSS availability alone is not sufficient. |
| **3. Small CSS-native embed for fixed metrics**                         | A solo developer needing three metrics may not want a dashboard/report-builder platform. Quill already offers headless APIs, themes and chart customization; differentiation must be lower total integration effort, not the existence of customization. | Publish a compatible small SDK; keep explicit result props as a first-class path; stable CSS variables/slots and `className`/`style`; two host themes; clear server authorization adapter boundary and errors. Preserve B+ as the Studio baseline.                                    | Prepared Next.js/PostgreSQL/session fixture: target median ≤15 minutes from quickstart to exact, tenant-scoped, approved embed; 4/5 finish and restyle both themes without internal selectors or `!important`; compare active time/configuration and production bundle measurements with Quill. Disprove if Quill is as easy or work shifted to the host exceeds savings. | **Medium**, increasing sharply with hosted execution/auth. Existing inline styles are a real gap. A thin chart wrapper may offer too little value or push difficult backend work to the consumer.        |

## Recommended positioning and issue implications

**Narrow to “reviewed, reproducible SaaS metrics you can embed and own.”** Keep Ask → Build → Validate → Embed as the journey, but lead with verified definitions and developer ownership. Treat natural language as an authoring aid once execution is trustworthy. Target teams shipping a small fixed set of customer metrics; avoid competing for enterprise self-service BI breadth. A beautiful B+ interface can aid comprehension but is not defensibility.

The choice over Quill would be: **a developer needs a few exact, reviewable, app-owned metrics more than a reporting platform**. That sentence is credible only after the three hypotheses pass. For teams needing broad AI reporting, tenant-aware report builders and managed BI today, Quill's documented surface is materially ahead. If interviews show that is what our target buyers need, reconsider the wedge instead of building a smaller-looking clone.

| Issue                                                                                                                         | Specific implication / acceptance evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [BRU-463 — correctness](https://linear.app/brunosimplicio/issue/BRU-463/validate-metric-execution-and-numeric-correctness)    | Start with the oracle below and one explicit net-receipts policy. Add independent PostgreSQL expected-value execution later; cover multiple adjustments/fan-out, old-payment refunds, negative months, timezone/period edges, nulls/duplicates, missing/cross-tenant references, unsafe totals and currency rejection. Expose charges/receipts, refunds, fees and freshness separately. Require a deliberately wrong query/definition to fail; schema-valid is not numerically correct. Do not implement the B+ sample's orphan policy as if validated. |
| [BRU-465 — API/SDK](https://linear.app/brunosimplicio/issue/BRU-465/build-versioned-metric-api-and-typed-react-sdk-prototype) | Preserve the current result-prop path while testing need for remote resolution. Define result-to-approved-version/evidence identity and signed net values before inventing `<Metric id token>`. A remote path still needs scoped server auth and BRU-461 tenant work; process-local approval cannot cross that boundary. Deliver stable CSS tokens/slots and consumer `style`, two distinct themes, accessibility/SSR/hydration checks, and publishable package output. Quill already sets a strong customization baseline.                             |
| [BRU-466 — onboarding](https://linear.app/brunosimplicio/issue/BRU-466/create-developer-onboarding-and-integration-examples)  | One repeatable Next.js + read-only PostgreSQL + existing-session walkthrough: synthetic seed → explicit metric policy → oracle match → tenant-negative checks → review/version → React → customer CSS. Offer a local result-prop path and label hosted concepts separately. Record all eight checkpoints and unsuccessful attempts; validate the ≤15-minute target with new developers, not author familiarity. Show B+ and a clearly different app theme using the same data.                                                                          |
| [BRU-468 — pilots](https://linear.app/brunosimplicio/issue/BRU-468/run-usability-tests-and-paid-pilot-validation)             | Test the three hypotheses with five small-SaaS builders, including developers who would choose Quill or hand SQL. Measure exact-answer completion, errors caught, ability to explain/refute a metric, integration/restyling time, effort shifted to the host, and willingness to pay. Seek the issue's two credible paid pilot leads; if trust gates add work without purchase intent, record an explicit no-go or revise positioning. Obtain Quill access/terms through an authorized follow-up before claiming comparative speed/cost.                |

## Reproduction appendix

No production code, package manifest, dependency list or database was changed. Run from the repository root with existing Node 24/pnpm tooling:

```sh
pnpm install --frozen-lockfile
pnpm test
```

Observed: **4 test files / 44 tests passed**. This is the existing suite, not a new end-to-end benchmark. To repeat the additional experiment, save the Python block as `/tmp/bru482-oracle.py`, run `python3 /tmp/bru482-oracle.py > /tmp/bru482-oracle.json`, then pipe the JavaScript block to `pnpm exec node --input-type=module`. Both blocks were executed during this research. The JavaScript uses the already-installed Vitest/Vite dependency graph as an in-process TypeScript loader; it starts no HTTP listener.

<details>
<summary>Synthetic rows and independent integer-cent oracle (Python standard library)</summary>

```python
import json
from datetime import datetime, timezone

# Synthetic PostgreSQL-shaped rows; amounts are integer USD cents.
organizations = {"acme", "orbit"}
users = {"u1": "acme", "u2": "acme", "u3": "orbit"}
# charge_id: (organization_id, user_id, amount_cents)
charges = {
    "c1": ("acme", "u1", 10000), "c2": ("acme", "u2", 20000),
    "c3": ("acme", "u1", 5000), "c4": ("acme", "u2", 30000),
    "old": ("acme", "u1", 8000), "next": ("acme", "u2", 9000),
    "unpaid": ("acme", "u1", 7000), "other": ("orbit", "u3", 999999),
}
# payment_id: (charge_id, status, paid_at)
payments = {
    "p1": ("c1", "captured", "2026-01-15T12:00:00Z"),
    "p2": ("c2", "captured", "2026-01-31T23:30:00-02:00"),
    "p3": ("c3", "failed", "2026-03-05T12:00:00Z"),
    "p4": ("c4", "captured", "2026-06-30T23:59:59Z"),
    "po": ("old", "captured", "2025-12-15T12:00:00Z"),
    "pn": ("next", "captured", "2026-07-01T00:00:00Z"),
    "pb": ("other", "captured", "2026-02-10T12:00:00Z"),
}
# adjustment_id, organization_id, payment_id, status, timestamp, cents
refunds = [
    ("r1", "acme", "p1", "settled", "2026-02-10T12:00:00Z", 1000),
    ("r2", "acme", "p1", "settled", "2026-02-11T12:00:00Z", 500),
    ("r3", "acme", "p2", "settled", "2026-03-10T12:00:00Z", 2000),
    ("r4", "acme", "po", "settled", "2026-01-05T12:00:00Z", 3000),
    ("rp", "acme", "p4", "pending", "2026-06-20T12:00:00Z", 4000),
    ("rn", "acme", "p4", "settled", "2026-07-02T12:00:00Z", 1000),
    ("rb", "orbit", "pb", "settled", "2026-02-11T12:00:00Z", 12345),
]
fees = [
    ("f1", "acme", "p1", "settled", "2026-01-15T12:00:00Z", 300),
    ("f2", "acme", "p1", "settled", "2026-01-16T12:00:00Z", 50),
    ("f3", "acme", "p2", "settled", "2026-02-01T12:00:00Z", 600),
    ("f4", "acme", "p4", "settled", "2026-06-30T23:59:59Z", 900),
    ("fn", "acme", "pn", "settled", "2026-07-01T00:00:00Z", 270),
    ("fb", "orbit", "pb", "settled", "2026-02-10T12:00:00Z", 7777),
]
months = [f"2026-{m:02d}" for m in range(1, 7)]

def bucket(timestamp):
    return datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(timezone.utc).strftime("%Y-%m")

def calculate(tenant, adjustments):
    totals = {m: [0, 0, 0] for m in months}
    invoices = []
    for pid, (cid, status, at) in payments.items():
        org, uid, cents = charges[cid]
        assert org in organizations and users[uid] == org
        if org == tenant and status == "captured":
            invoices.append(dict(id=pid, amountCents=cents, currency="USD", status="paid", paidAt=at))
            if bucket(at) in totals:
                totals[bucket(at)][0] += cents
    for column, rows in enumerate(adjustments, 1):
        assert len({row[0] for row in rows}) == len(rows)
        for _, org, pid, status, at, cents in rows:
            cid, payment_status, _ = payments[pid]
            assert org == charges[cid][0] and payment_status == "captured"
            if org == tenant and status == "settled" and bucket(at) in totals:
                totals[bucket(at)][column] += cents
    return totals, invoices

totals, invoices = calculate("acme", [refunds, fees])
collected = [v[0] for v in totals.values()]
net = [p - r - f for p, r, f in totals.values()]
assert collected == [10000, 20000, 0, 0, 0, 30000]
assert net == [6650, 17900, -2000, 0, 0, 29100]
assert sum(net) == 60000 - 6500 - 1850 == 51650
assert calculate("orbit", [refunds, fees])[0]["2026-02"] == [999999, 12345, 7777]
assert calculate("acme", [list(reversed(refunds)), list(reversed(fees))])[0] == totals
try:
    calculate("acme", [refunds + [("bad", "acme", "pb", "settled", "2026-02-01T00:00:00Z", 1)], fees])
    raise RuntimeError("Cross-tenant adjustment accepted")
except AssertionError:
    pass
print(json.dumps(dict(asOf="2026-07-01", months=months, totals=totals, net=net, invoices=invoices)))
```

</details>

<details>
<summary>Current Analyticool lifecycle, collected subset, failure boundary and SSR replay</summary>

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const fixture = JSON.parse(readFileSync("/tmp/bru482-oracle.json", "utf8"));
const requireVitest = createRequire(import.meta.resolve("vitest/package.json"));
const requireReact = createRequire(resolve("packages/react/package.json"));
const { createServer } = await import(requireVitest.resolve("vite"));
const React = requireReact("react");
const { renderToStaticMarkup } = requireReact("react-dom/server");
const loader = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  configFile: false,
});
try {
  const core = await loader.ssrLoadModule("/packages/core/src/index.ts");
  const { MetricChart } = await loader.ssrLoadModule(
    "/packages/react/src/index.ts",
  );
  const draft = core.generateMetricProposal(
    core.proposalExamples.monthlyRevenue,
    "bru482",
  );
  const ready = core.submitMetricProposal(draft);
  const publication = core.publishMetricProposal(
    core.approveMetricProposal(ready, { reviewer: "fixture-reviewer" }),
  );
  const result = core.calculateMonthlyRevenue(publication.definition, {
    asOf: fixture.asOf,
    invoices: fixture.invoices,
  });
  assert.deepEqual(
    result.points.map((p) => p.valueCents),
    [10000, 20000, 0, 0, 0, 30000],
  );
  const markup = renderToStaticMarkup(
    React.createElement(MetricChart, { result, className: "customer-revenue" }),
  );
  assert.ok(
    markup.includes("customer-revenue") &&
      markup.includes("$300.00") &&
      markup.includes("View exact values"),
  );
  assert.throws(
    () =>
      core.generateMetricProposal(
        "Show me monthly net revenue for the last six months.",
        "net",
      ),
    /Unsupported fixture request/,
  );
  const pending = core.submitMetricProposal(
    core.generateMetricProposal(
      core.proposalExamples.netRevenue,
      "net-example",
    ),
  );
  assert.equal(pending.status, "needs_clarification");
  assert.equal(pending.definition, null);
  assert.throws(() =>
    core.approveMetricProposal(pending, { reviewer: "fixture-reviewer" }),
  );
  const negative = {
    ...result,
    points: result.points.map((p, i) => ({ ...p, valueCents: fixture.net[i] })),
  };
  assert.equal(
    core.monthlyRevenueResultSchema.safeParse(negative).success,
    false,
  );
  console.log(
    JSON.stringify({
      lifecycle: [draft.status, ready.status, "approved", "published"],
      collectedCents: result.points.map((p) => p.valueCents),
      ssr: "pass",
      literalNetRequest: "rejected",
      ambiguousExample: pending.status,
      negativeNetResult: "rejected",
    }),
  );
} finally {
  await loader.close();
}
```

</details>

## Sources and remaining unknowns

All sources accessed 2026-11-06. Product docs are mutable; npm artifact URLs and repository commit links pin the source inspected. Marketing illustrations were not treated as live integrations.

| ID  | Primary source                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Supports                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Q1  | [Quill homepage](https://quill.co/)                                                                                                                                                                                                                                                                                                                                                                                                                                        | Current positioning, illustrated guardrails/CLI, sales CTA. Browser inspection corroborated page text.                |
| Q2  | [Documentation index](https://quill.co/docs/llms.txt), [architecture](https://quill.co/docs/architecture)                                                                                                                                                                                                                                                                                                                                                                  | Current docs discovery, cloud/hybrid/self-host boundaries and metadata dependency.                                    |
| Q3  | [BI quickstart](https://quill.co/docs/bi-platform/quickstart)                                                                                                                                                                                                                                                                                                                                                                                                              | Read-only PostgreSQL onboarding, source/schema setup.                                                                 |
| Q4  | [Create a report](https://quill.co/docs/bi-platform/report)                                                                                                                                                                                                                                                                                                                                                                                                                | SQL/AI/no-code creation, result inspection, manual/AI edits, saving.                                                  |
| Q5  | [Virtual tables](https://quill.co/docs/bi-platform/virtual-table)                                                                                                                                                                                                                                                                                                                                                                                                          | Reusable editable SQL views and dependency caveat.                                                                    |
| Q6  | [BI concepts](https://quill.co/docs/bi-platform/overview)                                                                                                                                                                                                                                                                                                                                                                                                                  | Environments and entity-level promotion.                                                                              |
| Q7  | [Server quickstart](https://quill.co/docs/server/quickstart), [provider](https://quill.co/docs/react/quill-provider)                                                                                                                                                                                                                                                                                                                                                       | Backend query contract, tenants, existing auth headers/credentials, provider configuration.                           |
| Q8  | [Themes](https://quill.co/docs/react/themes)                                                                                                                                                                                                                                                                                                                                                                                                                               | Theme properties and component replacement.                                                                           |
| Q9  | [React quickstart](https://quill.co/docs/react/quickstart), [headless dashboard](https://quill.co/docs/react/headless-dashboard)                                                                                                                                                                                                                                                                                                                                           | Component/hook integration and customer UI composition.                                                               |
| Q10 | [React 2.16.110 declarations](https://unpkg.com/@quillsql/react@2.16.110/dist/index.d.ts), [manifest](https://unpkg.com/@quillsql/react@2.16.110/package.json), [tarball](https://registry.npmjs.org/@quillsql/react/-/react-2.16.110.tgz)                                                                                                                                                                                                                                 | Actual exported contracts/peers, newer hooks, StaticChart ID API, inspected license metadata.                         |
| Q11 | [Node 0.9.27 query implementation](https://unpkg.com/@quillsql/node@0.9.27/dist/cjs/index.js), [manifest](https://unpkg.com/@quillsql/node@0.9.27/package.json), [Next.js admin route](https://github.com/quill-sql/self-hosted-example-app/blob/086f5753efb6020c2a026b6bf58dae139bd51e34/app/api/quill/route.ts), [promotion example](https://github.com/quill-sql/self-hosted-example-app/blob/086f5753efb6020c2a026b6bf58dae139bd51e34/example-github-action/README.md) | Metadata calls, constructor requirements, ISC metadata; admin-only sample and CI promotion.                           |
| Q12 | [CLI 0.1.0 promotion](https://unpkg.com/@quillsql/cli@0.1.0/dist/commands/promote.js), [validation](https://unpkg.com/@quillsql/cli@0.1.0/dist/core/validator.js), [SQL checks](https://unpkg.com/@quillsql/cli@0.1.0/dist/utils/sql.js), [license](https://unpkg.com/@quillsql/cli@0.1.0/LICENSE)                                                                                                                                                                         | Sandbox/release control, SQL validation, MIT artifact.                                                                |
| Q13 | [Semantic-layer product page](https://quill.co/semantic-layer)                                                                                                                                                                                                                                                                                                                                                                                                             | Marketing descriptions of measures/dimensions, tenant semantics and agent context; inspected in browser.              |
| Q14 | [AI reporting product page](https://quill.co/ai-reporting)                                                                                                                                                                                                                                                                                                                                                                                                                 | Illustrated query/source visibility and AI flows; inspected in browser.                                               |
| Q15 | [Tenant concepts](https://quill.co/docs/bi-platform/tenant)                                                                                                                                                                                                                                                                                                                                                                                                                | Row/schema/database divisions, owner/viewer roles.                                                                    |
| Q16 | [Official sample README](https://github.com/quill-sql/demo/blob/ddd8161a9de88b852f0c91db0dc8092bfff4f148/README.md), [server](https://github.com/quill-sql/demo/blob/ddd8161a9de88b852f0c91db0dc8092bfff4f148/server/index.ts), [AI demo configuration](https://github.com/quill-sql/ai-reporting/blob/768c518592b40725d437cccf539c1611fec0e283/.env.example)                                                                                                              | Required database/keys, mocked server-side tenant selection, additional public demo requiring identity configuration. |
| Q17 | [BI self-hosting](https://quill.co/docs/bi-platform/self-host), [pricing path inspected](https://quill.co/pricing)                                                                                                                                                                                                                                                                                                                                                         | Admin package deployment; no usable current price schedule from the inspected path.                                   |
| Q18 | [StaticChart guide](https://quill.co/docs/react/static-chart)                                                                                                                                                                                                                                                                                                                                                                                                              | Older report-data example, compared with current published declarations.                                              |
| A1  | [Baseline README](https://github.com/bernacle/analyticool/blob/075ff87fd0d83231cfa412f45d1b142f33e5f0d3/README.md)                                                                                                                                                                                                                                                                                                                                                         | Implemented scope and explicit prototype limitations.                                                                 |
| A2  | [Executor/contracts](https://github.com/bernacle/analyticool/blob/075ff87fd0d83231cfa412f45d1b142f33e5f0d3/packages/core/src/monthly-revenue.ts), [tests](https://github.com/bernacle/analyticool/blob/075ff87fd0d83231cfa412f45d1b142f33e5f0d3/packages/core/src/monthly-revenue.test.ts)                                                                                                                                                                                 | Paid-invoice semantics, integer/period invariants, nonnegative result boundary.                                       |
| A3  | [Proposal generator](https://github.com/bernacle/analyticool/blob/075ff87fd0d83231cfa412f45d1b142f33e5f0d3/packages/core/src/proposal-generator.ts), [lifecycle](https://github.com/bernacle/analyticool/blob/075ff87fd0d83231cfa412f45d1b142f33e5f0d3/packages/core/src/proposal.ts), [tests](https://github.com/bernacle/analyticool/blob/075ff87fd0d83231cfa412f45d1b142f33e5f0d3/packages/core/src/proposal.test.ts)                                                   | Two prompts, clarification fallback, local approval/publication authority.                                            |
| A4  | [React components](https://github.com/bernacle/analyticool/blob/075ff87fd0d83231cfa412f45d1b142f33e5f0d3/packages/react/src/metric-chart.tsx), [React manifest](https://github.com/bernacle/analyticool/blob/075ff87fd0d83231cfa412f45d1b142f33e5f0d3/packages/react/package.json), [demo selection](https://github.com/bernacle/analyticool/blob/075ff87fd0d83231cfa412f45d1b142f33e5f0d3/apps/demo/lib/demo-metric.ts)                                                   | Result-prop rendering, inline styles, private source package, synthetic tenant filtering.                             |
| A5  | [B+ specification](https://github.com/bernacle/analyticool/blob/075ff87fd0d83231cfa412f45d1b142f33e5f0d3/docs/design/darkroom/SPEC.md), [design README](https://github.com/bernacle/analyticool/blob/075ff87fd0d83231cfa412f45d1b142f33e5f0d3/docs/design/darkroom/README.md), [license](https://github.com/bernacle/analyticool/blob/075ff87fd0d83231cfa412f45d1b142f33e5f0d3/LICENSE)                                                                                    | Proposed vs. implemented distinction, consumer CSS intent, Apache-2.0 source.                                         |
| K1  | [ktx README](https://github.com/Kaelio/ktx/blob/49a4ae6f5b28c904da921afc0ee72da6db7ac202/README.md)                                                                                                                                                                                                                                                                                                                                                                        | Local context layout and recommended Git contents.                                                                    |
| K2  | [Semantic querying](https://github.com/Kaelio/ktx/blob/49a4ae6f5b28c904da921afc0ee72da6db7ac202/docs-site/content/docs/concepts/semantic-layer-internals.mdx)                                                                                                                                                                                                                                                                                                              | YAML contract, grain/cardinality, planner/fan-out design and wiki/compiler distinction.                               |
| K3  | [Model validation tool](https://github.com/Kaelio/ktx/blob/49a4ae6f5b28c904da921afc0ee72da6db7ac202/packages/cli/src/context/sl/tools/sl-validate.tool.ts)                                                                                                                                                                                                                                                                                                                 | References/grain/join model checks, separate from arithmetic proof.                                                   |
| K4  | [Read-only SQL boundary](https://github.com/Kaelio/ktx/blob/49a4ae6f5b28c904da921afc0ee72da6db7ac202/packages/cli/src/context/connections/read-only-sql.ts)                                                                                                                                                                                                                                                                                                                | Statement checks and documented parser-backed validation boundary.                                                    |

The four follow-up issue descriptions were read directly through the connected Linear tool; their acceptance criteria informed the recommendations above. The older BRU-465 note saying B+ was not published is superseded by the verified PR #3 merge. No Linear issues were edited.

**Remaining unknowns and next evidence:**

- An authorized Quill trial/demo with this exact fixture: prompt clarification, query edits, independent assertions, promotion, embedded version stability, CSS effort and elapsed time. Public access did not establish any of these runtime outcomes.
- Quill price/usage limits, minimum commitment, self-host licensing, data sent to its metadata/AI endpoints, disconnected deployment, rollback and audit/reviewer guarantees. Ask for primary docs or written terms; do not substitute third-party price estimates.
- Tenant security in both products: forged metadata, cross-tenant joins, direct report access, cache reuse, export/stream boundaries, and schema changes need an authorized integration test. Source inspection here is not a security certification.
- Whether small SaaS developers value evidence/approval enough to choose it over Quill's broader feature set or existing SQL plus a chart library. Until the pilot evidence exists, the proposed wedge is a hypothesis.

[Q1]: https://quill.co/
[Q2]: https://quill.co/docs/llms.txt
[Q3]: https://quill.co/docs/bi-platform/quickstart
[Q4]: https://quill.co/docs/bi-platform/report
[Q5]: https://quill.co/docs/bi-platform/virtual-table
[Q6]: https://quill.co/docs/bi-platform/overview
[Q7]: https://quill.co/docs/server/quickstart
[Q8]: https://quill.co/docs/react/themes
[Q9]: https://quill.co/docs/react/quickstart
[Q10]: https://unpkg.com/@quillsql/react@2.16.110/dist/index.d.ts
[Q11]: https://unpkg.com/@quillsql/node@0.9.27/dist/cjs/index.js
[Q12]: https://unpkg.com/@quillsql/cli@0.1.0/dist/commands/promote.js
[Q13]: https://quill.co/semantic-layer
[Q14]: https://quill.co/ai-reporting
[Q15]: https://quill.co/docs/bi-platform/tenant
[Q16]: https://github.com/quill-sql/demo/blob/ddd8161a9de88b852f0c91db0dc8092bfff4f148/README.md
[Q17]: https://quill.co/docs/bi-platform/self-host
[Q18]: https://quill.co/docs/react/static-chart
[A1]: https://github.com/bernacle/analyticool/blob/075ff87fd0d83231cfa412f45d1b142f33e5f0d3/README.md
[A2]: https://github.com/bernacle/analyticool/blob/075ff87fd0d83231cfa412f45d1b142f33e5f0d3/packages/core/src/monthly-revenue.ts
[A3]: https://github.com/bernacle/analyticool/blob/075ff87fd0d83231cfa412f45d1b142f33e5f0d3/packages/core/src/proposal-generator.ts
[A4]: https://github.com/bernacle/analyticool/blob/075ff87fd0d83231cfa412f45d1b142f33e5f0d3/packages/react/src/metric-chart.tsx
[A5]: https://github.com/bernacle/analyticool/blob/075ff87fd0d83231cfa412f45d1b142f33e5f0d3/docs/design/darkroom/SPEC.md
[K1]: https://github.com/Kaelio/ktx/blob/49a4ae6f5b28c904da921afc0ee72da6db7ac202/README.md
[K2]: https://github.com/Kaelio/ktx/blob/49a4ae6f5b28c904da921afc0ee72da6db7ac202/docs-site/content/docs/concepts/semantic-layer-internals.mdx
[K3]: https://github.com/Kaelio/ktx/blob/49a4ae6f5b28c904da921afc0ee72da6db7ac202/packages/cli/src/context/sl/tools/sl-validate.tool.ts
[K4]: https://github.com/Kaelio/ktx/blob/49a4ae6f5b28c904da921afc0ee72da6db7ac202/packages/cli/src/context/connections/read-only-sql.ts
