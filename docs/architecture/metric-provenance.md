# Trusted metric provenance and auditable reconciliation

Status: **Proposed** — BRU-483, 2026-11-06. Decision owner: metric implementer and reviewer. Implementation follow-up: [BRU-463](https://linear.app/brunosimplicio/issue/BRU-463/validate-metric-execution-and-numeric-correctness).

Analyticool's initial promise is **reviewed, reproducible SaaS metrics developers can embed and own**, following Ask → Build → Validate → Embed. Trust comes from explicit, scoped evidence. A valid schema, completed calculation, approval click, or polished chart proves none of the other properties.

## 1. Decision and existing contract audit

Keep a small definition artifact and separate, content-addressed evidence records. Add one bounded operational net receipts definition and a separate signed result contract in BRU-463. Keep structural validation, review authority, execution, fixture comparison, and reconciliation orthogonal. No universal `verified: true` field.

This is a design document; all types and payloads below are **proposed contracts**, not exported APIs or implemented guarantees.

### Audited baseline

Checked GitHub merge state and actual source at [`803de3f30ced18388f00e9c7c98454e8bf37f210`](https://github.com/bernacle/analyticool/tree/803de3f30ced18388f00e9c7c98454e8bf37f210). The fetched `origin/main` matches this commit. Linear comments calling these PRs drafts are historical:

| PR                                                            | Delivered                                                | GitHub merged at (UTC) |
| ------------------------------------------------------------- | -------------------------------------------------------- | ---------------------- |
| [#2, BRU-460](https://github.com/bernacle/analyticool/pull/2) | Proposal lifecycle, local approval/publication/revisions | 2026-11-04 22:06:25    |
| [#3, BRU-456](https://github.com/bernacle/analyticool/pull/3) | Darkroom specification and static prototype              | 2026-11-04 22:03:29    |
| [#4, BRU-482](https://github.com/bernacle/analyticool/pull/4) | Quill research and independent synthetic oracle          | 2026-11-06 13:38:22    |

Read [BRU-460](https://linear.app/brunosimplicio/issue/BRU-460/define-trusted-metric-model-approval-and-versioning), [BRU-482](https://linear.app/brunosimplicio/issue/BRU-482/competitive-teardown-quill-vs-analyticool-time-to-verified-embed), [BRU-463](https://linear.app/brunosimplicio/issue/BRU-463/validate-metric-execution-and-numeric-correctness), their discussions, the [research and oracle](../research/competitors/quill-vs-analyticool.md), and [Darkroom SPEC §§4, 9–10](../design/darkroom/SPEC.md). Research reports independent arithmetic; it does not report a working net executor or live tenant isolation.

| Actual contract                                                                                                                              | Guaranteed today                                                                                                                                                   | Gap relevant to this decision                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`metricProposalSchema`, `validateProposalDefinition`](../../packages/core/src/proposal.ts)                                                  | Strict shape, supported collected-revenue calculation, known fixture fields in correct roles, required clarification before review; no joins                       | `evidence` explains fields, not numerical assertions. No source schema digest, computation evidence, approval timestamp, or fixture identity                              |
| [`generateMetricProposal`](../../packages/core/src/proposal-generator.ts)                                                                    | Two deterministic requests; ambiguous net-by-customer request has no executable definition; explicit collected-revenue fallback                                    | No net calculation, arbitrary question support, or source discovery                                                                                                       |
| `approveMetricProposal` / `publishMetricProposal`                                                                                            | Active snapshots tracked in WeakSets; clones, parsed JSON, stale snapshots cannot gain lifecycle authority; explicit nonempty reviewer label                       | Label is unauthenticated. No durable authority, audit log, signature, evidence-at-review list, or permission check                                                        |
| `publishedMetricVersionSchema` / `reviseMetricVersion`                                                                                       | Recursively frozen local snapshots; published definition equals reviewed definition/version; one local successor; old publication unchanged                        | Positive version number is not a globally unique version identity. Separate new lineages can reuse metric ID/version. Parsing publication JSON does not restore authority |
| [`monthlyRevenueDefinitionSchema`](../../packages/core/src/monthly-revenue.ts)                                                               | Literal v1 calculation and UTC/USD semantics; additive versioned schema supports later local revisions                                                             | No content identity; bindings and assumptions live in proposal, outside executable definition                                                                             |
| `calculateMonthlyRevenue` / invoice schema                                                                                                   | Pure deterministic paid-invoice sum, validated rows, six complete UTC months, zero fill, duplicate rejection, safe monthly integer cents                           | Assumes already-authorized rows. Can run without approval. No refund/fee streams, IO, data freshness, snapshot identity, or execution report                              |
| `monthlyRevenueResultSchema`                                                                                                                 | Metric ID/version, as-of date, currency/timezone, six ordered nonnegative monthly values                                                                           | Does not recompute totals from inputs or establish numerical correctness. No run timestamp, data identity, review linkage, reconciliation, or signed amounts              |
| [`monthly-revenue.test.ts`](../../packages/core/src/monthly-revenue.test.ts), [`proposal.test.ts`](../../packages/core/src/proposal.test.ts) | Exact collected values and exclusions, offsets/boundaries/leap/year, duplicates/overflow, deterministic behavior, lifecycle forgery/staleness, immutable revisions | Tests are useful fixture evidence for their cases; no portable report or net executor coverage. No assertion about production completeness/security follows               |
| [`packages/react`](../../packages/react/src), [README boundaries](../../README.md#current-boundaries)                                        | Components accept/validate caller-supplied results; core expects authorized rows                                                                                   | Neither components, selected demo workspace, definition approval, nor source names enforce tenant authorization                                                           |

**Gap summary:** local immutability is useful but does not give durable identity or authority. Structural validity is useful but does not prove a calculation. Fixture agreement supports only pinned inputs, expectations, definition, and implementation. Execution timestamps and source freshness are different facts; neither exists in today's result. Production source completeness and tenant enforcement remain application/connector responsibilities.

## 2. Minimal artifact and evidence model

Use five small records: **definition**, **execution**, **fixture verification**, **approval**, and **reconciliation**. Structural validation is a scoped report attached to the definition. A result references these records, rather than copying a mutable trust summary. Keep all records immutable by convention and verify their content references on consumption; future persistence must enforce immutability independently.

### Definition identity and contents

The identity tuple is `(metricId, metricVersion, definitionDigest)`, within an app-owned artifact namespace. `schemaVersion` describes serialization. `metricVersion` describes a reviewed revision. `definitionDigest` binds the entire reviewed meaning: question/name, calculation policy, bindings, relationships, assumptions, and clarification answers. A numeric version alone must never resolve execution.

Store the original request for context, the agreed business question for meaning, and a literal calculation identifier for execution. Formula text is explanatory and must agree with the calculation identifier. Do not execute formula strings. V1 net receipts is USD cents, UTC calendar months, fixed event attribution, no FX/proration/tax subtraction, no generic expression language. Unknown required decisions prevent approval; optional unknowns become explicit limitations.

Proposed TypeScript sketch (closed policies, bounded source roles):

```ts
type Digest = `sha256:${string}`; // Runtime: exactly 64 lowercase hex digits.
type ArtifactRef = { path: string; digest: Digest }; // App-relative, no secrets.
type DefinitionRef = {
  metricId: "operational-net-receipts";
  metricVersion: number;
  definitionDigest: Digest;
};
type FieldRef = { sourceId: string; table: string; field: string };
type Binding = {
  sourceId: string;
  schemaDigest: Digest;
  fields: Record<string, FieldRef>; // Required roles checked below, not free SQL.
};
type NetReceiptsDefinition = {
  schemaVersion: 1;
  metricId: "operational-net-receipts";
  metricVersion: number;
  originalRequest: string;
  name: "Operational net receipts";
  question: string;
  calculation: "captured-minus-settled-refunds-minus-posted-fees-v1";
  formula: "captured payments - settled refunds - posted processing fees";
  unit: "integer-cents";
  currency: "USD";
  timezone: "UTC";
  window: "last-six-complete-calendar-months";
  timeBasis: { payments: "capture"; refunds: "settlement"; fees: "posting" };
  bindings: Record<"charges" | "payments" | "refunds" | "fees", Binding>;
  relationships: readonly {
    from: FieldRef;
    to: FieldRef;
    cardinality: "many-to-one";
    ownership: "same-tenant-required";
  }[];
  policies: {
    aggregation: "independent-event-streams-then-monthly-sum";
    adjustments: "own-event-month-including-older-payments";
    unknownParent: "block-complete-result";
    crossTenantParent: "reject";
    duplicates: "reject";
    corrections: "unsupported-block";
    emptyMonths: "zero";
    missingSource: "block-complete-result";
  };
  assumptions: readonly { id: string; statement: string }[];
  clarifications: readonly {
    id: string;
    question: string;
    required: boolean;
    answer: string | null;
  }[];
  limitations: readonly string[];
};
type DefinitionArtifact = {
  definition: NetReceiptsDefinition;
  definitionDigest: Digest; // Hash of definition only; excludes this field.
};
type StructuralValidation = {
  definition: DefinitionRef;
  catalog: ArtifactRef;
  checkedAt: string;
  status: "valid" | "invalid";
  issues: string[];
  scope: "shape-references-and-supported-policy-only";
};
```

`Record<string, FieldRef>` is shorthand for the role maps below, not an open-ended field mapping API. The implementation must validate exact required keys, source/table/schema membership, field types and units, tenant ownership, and the fixed relationship graph. Strings do not authorize source access. Schema digest covers the declared source/table/field types, nullability, units, keys, and status mapping; it is a local catalog identity, not evidence a live schema was inspected.

| Binding  | Required roles → BRU-482 source fields                                                                 | Grain and relationships                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| charges  | `id`, `tenantId` → `organization_id`, `amountCents` → `amount_cents`                                   | Unique charge ID; full amount, one captured payment per charge in this bounded fixture                                |
| payments | `id`, `chargeId` → `charge_id`, `status`, `capturedAt` → `paid_at`                                     | Unique payment ID; many payments to one charge; more than one captured payment per charge is unsupported and rejected |
| refunds  | `id`, `tenantId` → `organization_id`, `paymentId` → `payment_id`, `status`, `settledAt`, `amountCents` | Unique refund ID; many refunds to one authorized captured payment                                                     |
| fees     | `id`, `tenantId` → `organization_id`, `paymentId` → `payment_id`, `status`, `postedAt`, `amountCents`  | Unique fee ID; many fees to one authorized captured payment                                                           |

All four bindings can reference local source `synthetic-billing-net-v1`. Table names are `charges`, `payments`, `refunds`, `processing_fees`. The research's refund/fee tuples have unnamed event timestamps: materialize them as `settled_at`/`posted_at` in the catalog. The research calls a fee status `settled`; this fixture mapping means **posted** for fees only, and must be recorded in the catalog and hashed. Never silently equate arbitrary provider settlement and posting statuses. All amounts are declared USD cents; no missing live currency may be assumed USD. Payments inherit tenant/amount from charges; adjustments carry their own tenant and require an independently scoped parent lookup. Users/organizations are research integrity context, not additional arithmetic joins.

### Execution and result provenance

`asOf` selects a reporting window; it is not a data availability cutoff or execution time. A frozen input snapshot defines which event states were observed. The same reporting period can change when late events arrive. Record a new run/data digest rather than overwriting the prior result.

```ts
type Period = {
  asOf: string; // ISO date; case study: 2026-07-01.
  startInclusive: string; // Valid ISO instant.
  endExclusive: string;
  timezone: "UTC";
};
type Knowledge<T> =
  | { state: "known"; value: T; evidence: ArtifactRef }
  | { state: "unknown"; reason: string };
type Warning = {
  code: string;
  severity: "warning" | "blocking";
  message: string;
  evidence: ArtifactRef[];
};
type ExecutionContext = {
  definition: DefinitionRef;
  implementation: ArtifactRef; // Manifest: code commit/digest, runtime, lockfile.
  period: Period;
  tenant: {
    scopeRef: string; // Opaque app scope label, never an access grant.
    enforcement: "caller-asserted" | "adversarially-tested-adapter";
    evidence: ArtifactRef[];
  };
  inputs: readonly {
    sourceId: string;
    schemaDigest: Digest;
    snapshot: Knowledge<ArtifactRef>;
    freshness: Knowledge<{ observedAt: string; completeThrough: string }>;
    completeness: "declared-complete" | "incomplete" | "unknown";
  }[];
};
type MonthlyNetPoint = {
  month: string;
  capturedCents: number;
  settledRefundCents: number;
  postedFeeCents: number;
  netCents: number; // Signed safe integer, including negative months.
};
type ExecutionReport = {
  schemaVersion: 1;
  context: ExecutionContext;
  executedAt: string;
  warnings: Warning[];
  outcome:
    | { status: "completed"; points: MonthlyNetPoint[]; totalNetCents: number }
    | { status: "blocked" | "failed"; issues: string[] }; // No complete result.
};
type NetReceiptsResult = {
  schemaVersion: 1;
  kind: "monthly-operational-net-receipts";
  execution: ArtifactRef; // Resolve and validate completed ExecutionReport.
  structuralValidation:
    { state: "not_checked" } | { state: "recorded"; report: ArtifactRef };
  approval:
    { state: "not_approved" } | { state: "recorded"; report: ArtifactRef };
  fixtureVerification:
    | { state: "not_verified"; reason: string }
    | { state: "recorded"; report: ArtifactRef };
  reconciliation:
    | { state: "not_verified"; reason: string }
    | { state: "recorded"; report: ArtifactRef };
};
```

The result envelope avoids duplicating amounts with a second, potentially inconsistent copy. An in-memory response may bundle the resolved immutable records. `recorded` means available evidence, **not passed or trusted**. Resolve report statuses and applicability before displaying an indicator. A production run can link fixture evidence for its definition/implementation without implying the production inputs were tested. Raw live data may have an unknown snapshot; that run is explicitly not exactly reproducible. The fixture path requires known content-addressed inputs.

### Verification and approval evidence

```ts
type ExpectedOutcome =
  | { kind: "values"; points: MonthlyNetPoint[]; totalNetCents: number }
  | { kind: "rejection"; issueCodes: string[] };
type FixtureVerification = {
  schemaVersion: 1;
  method: "independent-fixture-comparison";
  definition: DefinitionRef;
  implementation: ArtifactRef;
  fixture: ArtifactRef; // Includes every source, historical parents, tenant, period.
  expected: ArtifactRef; // Independently authored expected outcomes and rationale.
  oracle: { artifact: ArtifactRef; independence: string };
  executedAt: string;
  cases: readonly {
    id: string;
    execution: ArtifactRef;
    expected: ExpectedOutcome; // Must equal the pinned expectations entry.
    actual: ExpectedOutcome | { kind: "execution-failure"; issues: string[] };
    status: "passed" | "failed";
    failedAssertions: string[];
  }[];
  tolerance: { absoluteCents: 0; reason: "exact-integer-fixture" };
  status: "passed" | "failed" | "inconclusive";
  limitations: readonly string[];
};
type ApprovalReport = {
  schemaVersion: 1;
  definition: DefinitionRef;
  actor: { reviewerId: string; identity: "self-asserted-local" };
  authority: "process-local-review";
  decidedAt: string;
  decision: "approved" | "rejected";
  evidenceAvailable: readonly ArtifactRef[];
  acknowledgedLimitations: readonly string[];
  reason: string;
};
```

The reviewer explicitly accepts **that definition**, with an immutable list of the reports available at the time. Later successful tests do not retroactively become review evidence. Store a subsequent review event if they must be accepted. A failed negative-test execution can correctly pass its expected rejection assertion; an unexpected exception cannot. Missing oracle/expectations/run artifacts make verification inconclusive; comparison mismatch makes it failed. The candidate calculator must never generate its own expected values. An independently written oracle can still share a mistaken business assumption: record human-reviewed arithmetic and its scope.

Approval can precede fixture verification: the UI must say “Definition approved locally; fixture not verified.” BRU-463's **fixture-verified publication acceptance** requires a passing applicable report reviewed at approval, structural validity, and no unresolved required decisions. A separate local experiment may record definition approval without passing that gate; it earns no fixture indicator. Neither path grants data access. An imported self-asserted approval is historical context; it cannot recreate the existing WeakSet capability. Reapproval in the receiving trusted local lifecycle is required. No authenticated authority variant is offered until a real authority mechanism exists.

### Zod sketches and semantic checks

Proposed additive schemas, using the repository's existing Zod dependency:

```ts
import { z } from "zod";

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const signedCentsSchema = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const unsignedCentsSchema = signedCentsSchema.nonnegative();
const definitionRefSchema = z.strictObject({
  metricId: z.literal("operational-net-receipts"),
  metricVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  definitionDigest: digestSchema,
});
const netPointSchema = z.strictObject({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  capturedCents: unsignedCentsSchema,
  settledRefundCents: unsignedCentsSchema,
  postedFeeCents: unsignedCentsSchema,
  netCents: signedCentsSchema,
});
const netValuesSchema = z
  .strictObject({
    points: z.array(netPointSchema).length(6),
    totalNetCents: signedCentsSchema,
  })
  .superRefine(({ points, totalNetCents }, ctx) => {
    for (const p of points) {
      if (
        BigInt(p.netCents) !==
        BigInt(p.capturedCents) -
          BigInt(p.settledRefundCents) -
          BigInt(p.postedFeeCents)
      ) {
        ctx.addIssue({
          code: "custom",
          message: `Component mismatch: ${p.month}`,
        });
      }
    }
    if (
      points.reduce((s, p) => s + BigInt(p.netCents), 0n) !==
      BigInt(totalNetCents)
    ) {
      ctx.addIssue({ code: "custom", message: "Total mismatch" });
    }
  });
const localActorSchema = z.strictObject({
  reviewerId: z.string().trim().min(1),
  identity: z.literal("self-asserted-local"),
});
```

Implement full records with strict objects and discriminated unions, rejecting unsupported schema versions/authority kinds and omitted unknown states. These are sketches, not a complete validator. Additional required checks:

- Valid date/instant parsing, ordered exact six calendar months matching period/as-of, UTC offset normalization, start/end consistency; regex alone cannot validate a reporting period.
- Checked integer accumulation for each component and grand total; use exact intermediate arithmetic, reject any unsafe exposed aggregate, never clamp or round. A point's safe net cannot hide unsafe components.
- Recompute content digests and verify every reference; report/definition/implementation/fixture/tenant/period identities must agree. No empty case list may pass; all required cases and assertions must be present, including negative cases.
- A passed report has no failed assertions and all required comparisons passed. A completed report has no blocking warning. Freshness and incomplete-input limitations cannot disappear because arithmetic matched.
- Each input catalog/schema must match its definition binding, with the correct ownership and status/time mappings. A well-shaped invented report is still an untrusted claim until evidence is resolved and replayed or accepted within a stated trust boundary.

These checks establish internal consistency and applicability, not independent numerical proof. The original `monthlyRevenueDefinitionSchema`, `invoiceSchema`, `monthlyRevenueResultSchema`, calculator, and components keep their current v1 behavior. Do not insert signed net values into collected-revenue results or relabel a collected preview as net receipts. A future net presenter/adapter requires its own deliberate change.

## 3. Evidence dimensions and display rules

| Dimension            | States                                                                   | What it supports / required accompanying text                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structure            | `not_checked`, `valid`, `invalid`                                        | “Definition valid against catalog X.” Only shape/references/supported policy; no numerical claim                                                                                         |
| Review               | `not_approved`, `approved`, `rejected`; imported authority is untrusted  | “Definition v1 approved locally by reviewer X at T; identity self-asserted.” Show exact digest and evidence reviewed in Inspector                                                        |
| Execution            | `not_run`, `completed`, `blocked`, `failed`                              | “Calculated at T for Jan–Jun UTC from snapshot X.” Completed does not mean inputs are complete/fresh or independently checked                                                            |
| Fixture verification | `not_verified`, `passed`, `failed`, `inconclusive`                       | “Fixture checks passed: suite S, definition D, implementation I; production data not verified.” Only show passing indicator for matching immutable references and complete case coverage |
| Reconciliation       | `not_verified`, `matched`, `explained`, `unexplained`, `inconclusive`    | “Reconciled to control C for period P; bridge B; residual 0 cents,” or explicit remaining difference/unknown scope                                                                       |
| Source knowledge     | Known/unknown snapshot and freshness; complete/incomplete/unknown inputs | “Source freshness unknown,” or documented watermark; never substitute execution time for source freshness                                                                                |

These are independent dimensions, not a five-step promotion enum. A rejected definition can have a numerically matching fixture. An approved definition can fail tests. A completed production result can use stale inputs. A fixture-verified implementation can have an inconclusive payout comparison. Editing a definition invalidates applicability of prior approval/evidence to the new definition; old records remain true about the old artifact. Changing implementation requires new fixture runs; changing live input requires new execution/reconciliation evidence. Repeating a test need not create a new metric definition version.

No percentage “confidence” derived from approval, schema validation, or a successful query. Do not present the stub's descriptive field evidence as model confidence. Use scoped words, timestamps, and text as well as color. Failed and unknown evidence must remain accessible even alongside passed dimensions. “Reconciled” requires comparability and supporting control evidence; matching two untrusted numbers is insufficient.

## 4. Operational net receipts case study

**Question:** How much did this tenant capture, less refunds settled and processing fees posted, in each of the last six complete UTC months?

**Formula:** operational net receipts = captured payments − settled refunds − posted processing fees. This is not GAAP revenue, recognized revenue, or processor payouts. Tax is not separately subtracted, currencies are not converted, annual payments are not prorated, and disputes/holds/reserves are not new implicit streams.

Freeze `asOf = 2026-07-01`, period `[2026-01-01T00:00:00Z, 2026-07-01T00:00:00Z)`, January–June, tenant `acme`, integer USD cents. Pending/failed events are excluded by their own status. Bucket each eligible event by its own timestamp after UTC normalization. Capture stays in its original month when a later refund settles. Calendar months without eligible activity are zero only when the required streams are present; absent data is not zero activity.

Use the **actual BRU-482 Python appendix rows**, not newly invented amounts. `p1` captures 10,000 cents in January, with two February refunds (1,000 + 500) and two January fees (300 + 50). `p2` captures at `2026-01-31T23:30:00-02:00`, so its 20,000 cents belong to February UTC. `r4` refunds 3,000 cents in January against December's valid captured payment `po`; the 8,000-cent old capture is outside the period. `r3` settles 2,000 cents in March. `p4` captures 30,000 cents on June 30 with a 900-cent posted fee. Failed `p3`, pending `rp`, July events, and independently scoped Orbit events contribute zero to Acme's period.

| Month    | Captured cents | Settled refund cents | Posted fee cents |  Net cents |
| -------- | -------------: | -------------------: | ---------------: | ---------: |
| January  |         10,000 |                3,000 |              350 |  **6,650** |
| February |         20,000 |                1,500 |              600 | **17,900** |
| March    |              0 |                2,000 |                0 | **−2,000** |
| April    |              0 |                    0 |                0 |      **0** |
| May      |              0 |                    0 |                0 |      **0** |
| June     |         30,000 |                    0 |              900 | **29,100** |
| Total    |     **60,000** |            **6,500** |        **1,850** | **51,650** |

Payments, refunds and fees must be scoped and validated independently, then unioned as signed events or aggregated separately before combining by month. Never join raw refunds × fees × payments before summation. Resolve historical authorized parents outside the reporting period; report-window filtering is not a parent existence check.

### Sample evidence payload

Illustrative construction, **not an executed Analyticool net-verification report**. `ref` computes a real digest from the referenced artifact under §7; the files named here are proposed BRU-463 outputs. Do not substitute dummy hashes and display a pass. `handwrittenCases` includes the table above and independently authored negative expectations.

```ts
const definition = {
  metricId: "operational-net-receipts" as const,
  metricVersion: 1,
  definitionDigest: digest(definitionArtifact.definition),
};
const example: FixtureVerification = {
  schemaVersion: 1,
  method: "independent-fixture-comparison",
  definition,
  implementation: ref("implementation.json"),
  fixture: ref("fixtures/bru-482-net-receipts.json"),
  expected: ref("fixtures/net-receipts.expected.json"),
  oracle: {
    artifact: ref("oracle/python-replay.json"),
    independence:
      "Standard-library oracle plus separately reviewed cent totals; no candidate calculator imports.",
  },
  executedAt: "2026-11-06T14:00:00Z", // Illustrative execution time, not asOf.
  cases: [
    {
      id: "acme-six-complete-months",
      execution: ref("runs/acme-six-months.json"),
      expected: handwrittenCases.acmeSixMonths,
      actual: candidateRunOutcome,
      status: "passed", // Legal only after exact comparison actually passes.
      failedAssertions: [],
    },
  ],
  tolerance: { absoluteCents: 0, reason: "exact-integer-fixture" },
  status: "passed", // Full suite must include §9; this single case is illustrative.
  limitations: [
    "Synthetic inputs only; no live connector or runtime tenant-security proof.",
  ],
};
```

The baseline case's expected values are the six component rows and total above; actual values come from the candidate execution report, not the expected file. Acceptance also checks each component: a matching total with incorrect monthly allocation, or offsetting refund/fee errors, must fail. A real report records every failed assertion, e.g. `2026-03.netCents: expected -2000, actual 0`, and has overall `failed` status. Approval might record reviewer `local:developer`, `identity: self-asserted-local`, `authority: process-local-review`, exact definition reference, decision time, and `[structuralReportRef, fixtureReportRef]`. Those labels demonstrate provenance, not a durable signature. Fixture freshness remains `unknown` with reason “Synthetic static rows; no live-source watermark”; its input snapshot is known and content-addressed. Reconciliation is `not_verified` with reason “No external control supplied.”

### Refund attribution, anomalies and corrections

| Case                                            | Required treatment in bounded v1                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Partial / multiple refunds                      | Subtract each unique settled amount once in its settlement month, never erase the whole payment. Multiple fees similarly count once in posting month                                                                                                                                    |
| Older valid payment                             | Include current-period adjustment after resolving authorized captured parent from history; no charge-month restatement. Missing history is not proof of an invalid payment                                                                                                              |
| Unknown payment                                 | Mark blocking `unknown-payment-reference`, retain restricted anomaly evidence, request historical data or mapping correction. No silent exclusion and no complete result, even if a partial subtotal is available                                                                       |
| Known parent not captured                       | Blocking invalid adjustment relationship; do not treat as merely outside period or as a legitimate settled refund                                                                                                                                                                       |
| Another tenant's ordinary events                | Filter independently out of this tenant's fact streams before aggregation; never disclose their amounts or identifiers to the tenant                                                                                                                                                    |
| In-scope adjustment points to another tenant    | Reject with `unauthorized-parent-reference`; never reassign it, count it, or treat it as an unknown older payment. Scoped lookup may expose only a generic unauthorized/unavailable error; trusted diagnostics distinguish it where authorized                                          |
| Out-of-scope adjustment points into this tenant | Exclude by adjustment's own tenant scope before joining; a payment-only tenant filter must not admit it                                                                                                                                                                                 |
| Pending / failed adjustments                    | Exclude from arithmetic. Validate eligible relationships and required fields; retain excluded counts in restricted diagnostics. Do not claim coverage of malformed discarded records                                                                                                    |
| Reversals / corrections                         | Explicitly unsupported: block complete result when such in-scope records are detected. Never subtract a reversal as a second ordinary refund or silently mutate an old row. A later definition must specify signed correction events and their effective timestamps                     |
| Late settlement / state change                  | A newly settled event is attributed to its actual settlement month, not its earlier pending creation time. A late-arriving record for an earlier month changes that month's new snapshot/run; preserve old run evidence. No historical reconstruction from today's mutable status alone |
| Duplicate event IDs                             | Reject duplicates within `(sourceId, table, tenant, eventId)`, including conflicting copies. Reused delivery IDs require an explicit ingestion policy later; do not guess a deduplication rule from equal amounts                                                                       |
| Missing/null required fields or stream          | Block complete result. An explicitly present empty declared-complete stream is different from a missing stream                                                                                                                                                                          |
| Stale/unknown freshness                         | Preserve calculation over known supplied rows with a warning and input knowledge states; no freshness/completeness badge. Known incomplete streams block complete result. Never invent a watermark or universal freshness SLA                                                           |
| Negative month                                  | Valid signed output (March −2,000); never zero clamp. Nonnegative source amounts, component/total overflow checks still apply                                                                                                                                                           |

For B+'s **three $412 orphan refunds**, the count/amount alone cannot choose the treatment. Authorized older parents mean subtract 41,200 cents in the refunds' settlement months. Unknown parents block a complete result; cross-tenant references reject it. Never offer “Exclude them” as a correctness shortcut. The prototype does not say whether the $412 is already within October's $8,130 refunds or provide settlement dates. Therefore this ADR cannot assert a revised October total. Resolving either inclusion or attribution requires new execution and reconciliation evidence; an unchanged chart is not evidence.

## 5. Reconciliation semantics

Reconciliation compares a pinned execution amount to an independently obtained control under documented economic meaning, tenant, currency, period, and data cutoff. An oracle using the same fixture is a fixture check, not a production external control. Record source independence and limitations; two queries against the same incomplete table cannot prove completeness.

Proposed reconciliation contract sketch:

```ts
type ReconciliationReport = {
  schemaVersion: 1;
  execution: ArtifactRef;
  checkedAt: string;
  metricSide: {
    definition: DefinitionRef;
    tenantScopeRef: string;
    period: Period;
    currency: "USD";
    amountCents: number;
  };
  control: {
    meaning: string;
    tenantScopeRef: string;
    period: Period;
    currency: "USD";
    amountCents: number;
    evidence: ArtifactRef[];
    independence: string;
    dataCutoff: Knowledge<string>;
  };
  comparability: "same-basis" | "bridge-required" | "unknown";
  bridge: readonly {
    reason: string;
    signedCents: number; // Added to control to express metric basis.
    evidence: ArtifactRef[];
    status: "supported" | "unconfirmed";
  }[];
  tolerance: {
    absoluteCents: number;
    businessReason: string;
    evidence: ArtifactRef[];
  };
  differenceCents: number; // metric - control
  residualCents: number; // metric - (control + supported bridge amounts)
  status: "matched" | "explained" | "unexplained" | "inconclusive";
  limitations: string[];
};
```

Use safe signed cents throughout. Compute differences and residuals, never accept caller arithmetic unchecked. `matched` requires comparable, adequate independent control evidence, no bridge, and residual within a documented tolerance. `explained` requires supported bridge evidence and residual within tolerance. An available same-basis control with a residual outside the justified tolerance is `unexplained`. Missing control evidence, unknown period/currency/scope/data cutoff, incomplete sources, or an unconfirmed required bridge is `inconclusive`. A missing control means `not_verified` on the result. Preserve known gaps even when status is inconclusive.

For integer USD fixtures and an exact same-basis control the tolerance is **0 cents**, because no conversion or rounding occurs. Production rounding/materiality exceptions require a reviewed business reason and supporting policy reference, pinned in the reconciliation report and visible to the reviewer. There is no default percentage tolerance. An approval cannot turn an unexplained difference into an explained one.

### Darkroom B+ example, with its limits

[`prototype/data.js`](../design/darkroom/prototype/data.js) computes October captured charges **$538,420** − refunds **$8,130** − fees **$16,906** = **$513,384**. It asserts payouts of **$513,291**, leaving **+$93** (9,300 cents). The prototype labels the ratio “within 0.02%.” These are synthetic display inputs with an arithmetic assertion, not independently verified source facts. Its tax/FX/dispute assumptions also differ from bounded USD net receipts; do not copy its label or policies into this definition.

Net receipts groups captures, refund settlements and fee postings; payout is a transfer to a bank on a payout schedule. They need not measure the same events or period. Cutoff lag, opening/closing unsettled balances, reserves/holds, payout fees, disputes, and transfers across periods may create differences. Each is a **candidate explanation**, never an automatic allowance. A dated settlement/balance report must identify amount, direction, tenant and period for a supported bridge.

The example report is `comparability: bridge-required`, `differenceCents: 9300`, no supported bridge, `residualCents: 9300`, tolerance 0, **`inconclusive`** because no independent payout/control details establish comparability. UI: “Payout comparison inconclusive — $93 difference; timing/control evidence missing.” If adequate comparable evidence later leaves $93 unexplained, show `unexplained`. If supported control records demonstrate a +9,300-cent bridge to the metric basis with zero residual, show “Reconciled with timing bridge,” naming the evidence and scope. Do not invent that bridge from the difference itself. Even a zero raw difference is inconclusive without adequate evidence.

## 6. Review and Inspector implications

Keep the [Darkroom decision band and drawer](../design/darkroom/SPEC.md#4-components); no production UI or prototype modification in this task.

Default Review shows business meaning, the signed result preview/period, one or two assumptions (“Refunds count when settled, including older payments”; “UTC months, USD cents”), one priority unresolved decision/warning, and **Approve definition v1**. A secondary line can say “Fixture checks passed; production data not verified.” If fixtures have not run, say so. Keep any “definition approval only” path explicit; do not imply passing the fixture publication gate. Blocking unknown parents or unsupported corrections prevent accepting a complete preview; explain why in the existing decision band.

The Inspector exposes:

| Existing area           | Proposed contents                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Definition              | Agreed question, exact formula/policies, definition version/digest, assumptions and clarification answers, reviewer/time and local authority limitation                                    |
| Sources                 | Bound fields/schema identity, grain/relationships, independent tenant scoping, input snapshots, reporting window, observed watermark or explicit unknown                                   |
| Checks                  | Structural checks separately from exact fixture assertions; expected vs actual components/total, failing cases, implementation and fixture digests, execution timestamp, scope limitations |
| Reconciliation          | Both figures/meanings/periods, control evidence, supported/unconfirmed bridge lines, absolute difference and residual, tolerance reason, explicit status                                   |
| SQL / technical details | Only show executable implementation details when available; do not fabricate SQL for today's pure executor. Link reviewable artifacts here                                                 |

Approval changes the review state; it must not change a failed comparison, remove warnings, or turn dashed data into a numerical correctness claim. Show local approval and scoped verification independently. Never use the prototype's “Matches Stripe payouts,” orphan exclusion, or source-health timestamps as real evidence.

## 7. Versioning and reproducibility

### Necessary identities in BRU-463

Use SHA-256 with a documented **`canonical-json-v1`** encoding for definition, declared catalog, fixture, expectations, implementation manifest, and evidence records. Canonicalization accepts JSON values only; sort object keys by ordinal code-unit order recursively, preserve array order, retain strings without Unicode normalization, emit UTF-8 without BOM/whitespace, and serialize only safe integer numbers in decimal form (normalize −0 to 0). Reject undefined, nonfinite numbers, unsupported types, duplicate JSON keys at ingestion, and unsafe numbers. No timestamps or approval data inside the definition hash. Freeze this encoding with test vectors before issuing identities.

Fixture arrays sort by `(sourceId, table, tenant, eventId)` before canonicalization, using an empty tenant sort key for tenantless payments and validating their ownership through charges; duplicate keys reject. Expected points sort by month and cases by stable case ID. Definition assumptions/answers retain their reviewed order. Thus execution is insensitive to input ordering; canonical fixture identity is also insensitive to delivery ordering, while altered timestamps, states, ownership or values change the digest. Hash raw external files as bytes when they are not canonical JSON, and specify that encoding in their manifest. Evidence record digests exclude their own outer identity field. Avoid cycles: definition → no evidence; execution → definition/inputs/implementation; verification → execution/expectations; approval → definition/available reports; reconciliation → execution/control. Result envelope references all of these.

The implementation manifest pins the candidate calculation code/commit, supported calculation policy ID, runtime version, dependency lockfile digest and verification harness/oracle versions. Mutable branch names or package versions alone are insufficient. A Git commit is useful provenance, but dirty local edits require a source-content digest or a refusal to issue a reproducible report. Clock timestamps identify a run, not a reproducible calculation input. Replays may have different execution timestamps/report digests; definition/input/implementation identities and outputs must match.

Version policy:

- Editing reviewed meaning, source bindings/schema identity, policies, assumptions or clarification answers creates a new metric revision and new digest, clears readiness/approval and requires new applicable checks. Preserve previous artifacts. Even a wording change is conservatively reviewed again in this minimal model.
- Same metric ID/version with differing digests is a conflict; reject implicit resolution, require a new revision or explicit namespace. Same digest never implies another app/tenant authorized it. The content tuple detects conflicts but does not create a durable global registry.
- New implementation/input/expectation evidence creates new reports; it does not rewrite a definition or prior review. Changed expectations require independent review and rerun, not acceptance of previous passing status.
- Keep v1 collected-revenue artifacts and behavior unchanged. Wrap legacy publications with truthful missing-evidence states if needed; do not mint retrospective authenticated approvals or invent historical timestamps/digests.

### Reproduction procedure

1. Obtain the exact reviewed definition artifact and approval record. Verify their digest linkage and local authority limitation; imported approval is historical and requires local reapproval for lifecycle actions.
2. Resolve the pinned source catalog/field bindings, synthetic fixture including historical parents, tenant scope and frozen reporting period. Recompute each digest.
3. Inspect the independently authored expectations and arithmetic rationale. Replay the standard-library oracle separately; never replace expectations with candidate output.
4. Use the pinned clean implementation/runtime/lockfile and run each declared case over the immutable inputs with no clock/IO dependency in the calculator.
5. Compare each month's components/net, ordered calendar coverage, grand total and rejection codes with exact integer equality. Run required incorrect-definition/implementation mutations and demonstrate their failure.
6. Produce a new verification report referencing the same definition, inputs, expectations and implementation. Preserve prior reports. Report unsupported cases and production limitations; source freshness and external reconciliation may remain unknown.

The existing BRU-482 appendix is executable today and validates its oracle only. BRU-463 must materialize the fixture/expected artifacts and actual candidate reports described here; these artifact paths and helpers do not exist yet. Developers can eventually commit the definition, catalog, synthetic fixtures, expectations, manifest and reports as app-owned reviewable files. Git review preserves provenance context but neither authenticates a self-asserted reviewer label nor restores process-local capability. JSON is sufficient for the first in-process tests; YAML export, CLI and MCP belong to BRU-484/467.

## 8. Trust and security boundaries

- **Definition approval is not execution authorization.** Existing core is callable without a publication. The app must enforce source permissions and derive tenant scope server-side; a serialized `reviewerId`, digest, result or scope label grants no access.
- **Every fact source and parent lookup is scoped.** Payments scope through authorized charges, refunds/fees by their own tenant plus authorized captured parent. Tenant scope must also apply to future caches, controls, result/evidence retrieval and exports. Never reuse cross-tenant cached evidence merely because a definition digest matches.
- **Local evidence is a claim with replayable inputs.** SHA-256 detects content changes relative to a known reference; it does not prove origin, completeness, honest authorship, authenticated review or nonrepudiation. Process-local WeakSets prevent local lifecycle forgery, not arbitrary caller execution or fabricated report files.
- **Fixtures do not prove production isolation.** Even adversarial synthetic scope tests cover only the local policy/implementation. A future adapter needs real adversarial source tests, scoped parent queries, permission enforcement and protected audit records before claiming runtime isolation. The `adversarially-tested-adapter` label requires pinned adapter evidence; it is not available today.
- **Source freshness is separate evidence.** A snapshot hash does not prove full extraction. A maximum event timestamp does not prove completeness. Use a source/extraction watermark with explicit scope; otherwise unknown. Multi-source runs need all required snapshots/watermarks, not only payments.
- **Evidence may contain sensitive data.** Use synthetic Git fixtures; do not commit customer rows, credentials or raw orphan IDs. Future production evidence references need app-enforced access control, restricted anomaly details and retention/redaction rules. URI/path resolution must be allowlisted; never fetch arbitrary imported paths/URLs or execute artifact content as code.

Durable version uniqueness, authenticated approver roles, signing, append-only audit storage, revocation and distribution trust require later infrastructure. No field in this ADR pretends those guarantees exist.

## 9. BRU-463 test matrix and acceptance criteria

Tests implement this bounded contract incrementally using existing test tooling, without a connector prerequisite. Keep handwritten expectations/oracle separate from candidate implementation helpers.

| Area                         | Required case / independently expected result                                                                                                             | Incorrect behavior that must fail                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Baseline components          | Table in §4, net `[6650,17900,-2000,0,0,29100]`, total `51650`; collected `60000`, refunds `6500`, fees `1850`                                            | Correct grand total but wrong monthly allocation or compensating component errors                                     |
| Fan-out                      | `p1`: one 10000 capture, refunds 1000+500, fees 300+50, each exactly once                                                                                 | Raw many-to-many joins duplicate capture/refunds/fees                                                                 |
| Partial/older refunds        | `r1/r2` only subtract actual amounts in February; `r4` subtracts 3000 in January, old 8000 capture excluded                                               | Full-payment erasure, capture-month attribution, report-window parent lookup drops `r4`                               |
| Unknown/noncaptured parent   | Add Acme settled refund with missing parent / failed `p3`: distinct blocking issue codes, no completed result                                             | Silent inner-join exclusion or classifying all missing references as old valid payments                               |
| Independent tenant scopes    | Orbit ordinary events excluded; Orbit result February components `[999999,12345,7777]`; inject Acme adjustment → `pb` and reject                          | Scope only payments; leak foreign adjustments; mistake unauthorized parent for valid/unknown history                  |
| Reverse ownership direction  | Inject Orbit adjustment → Acme `p1`: excluded from Acme before relationship aggregation; test both refunds and fees                                       | Parent-only scope admits an out-of-scope adjustment                                                                   |
| Status                       | Failed payment, pending/failed refund/fee excluded; change pending refund to settled with a valid settlement instant in its own month                     | Created-time attribution; include pending; missing settlement/posting instant passes                                  |
| UTC/period                   | Inclusive Jan 1; exclusive July 1; offset `p2` belongs February; event on June 30 UTC included; zero April/May; leap/year cases                           | Local-time bucketing, current partial month included, missing/unordered/duplicate month buckets                       |
| Signed money                 | March −2000 valid in new net schema; v1 collected schema still rejects negatives; decimals/EUR/unsafe sums reject                                         | Clamp negatives, coerce currency, round decimals, break v1 or allow overflowing components with safe-looking net      |
| Duplicates/order             | Duplicate ID in each source rejects, conflicting copy rejects, shuffled inputs reproduce outputs and canonical fixture digest                             | Double counting or deduplicate by amount; order-dependent accumulation/hash                                           |
| Corrections/state history    | Explicit reversal/correction blocks; new late-event snapshot creates a separate run preserving earlier report                                             | Silent historical mutation; reversal treated as a normal debit                                                        |
| Missing/freshness            | Empty declared-complete streams yield zero; absent/incomplete stream blocks; stale/unknown watermark yields warning without freshness claim               | Missing stream treated as empty; execution time used as freshness                                                     |
| Definition/approval identity | Change binding/answer/policy → new digest/review; same number/different digest conflicts; cloned/imported approval has no capability                      | Parsed `approved` or reviewer string restores authority; old approval silently moves to new version                   |
| Evidence applicability       | Changed fixture/expected/implementation/catalog/tenant/period rejects old report applicability; tampered artifact fails digest check                      | Reuse a passed report for different inputs or implementation; empty suite passes                                      |
| Numerical independence       | Wrong refund-month, fan-out, UTC bucketing, pending-inclusion, negative-clamp, and tenant-scope mutations MUST fail expected assertions                   | Expected values calculated by the same implementation; regenerated snapshots bless a bug                              |
| Reconciliation               | Exact independent same-basis control matches; supported timing bridge explains; nonzero residual is unexplained; missing/mismatched basis is inconclusive | $93 accepted by percentage, invented bridge, equal synthetic numbers displayed as independent production verification |

BRU-463 acceptance:

1. Add only the bounded definition, signed net result, required digest/evidence primitives and deterministic local calculation/tests. Preserve the v1 API/behavior and existing tests. No planner/connector is necessary to prove this fixture.
2. Materialize the full BRU-482 rows/catalog/status mapping, independent expectations and oracle rationale. Demonstrate all six component rows and total by exact equality with a real verification report; record rejected cases with explicit codes.
3. All matrix cases pass, and deliberately incorrect variants fail. Internal schema/component checks alone cannot satisfy this criterion.
4. From a clean checkout, another developer can follow a documented local replay with the same artifacts/implementation to obtain identical outputs and identities (excluding new run timestamps).
5. Reject mismatched/stale evidence applicability, preserve review history, and show or document scoped structure/approval/execution/fixture/reconciliation statuses without a universal badge. No production security, freshness or financial-accounting claim is made.
6. Run repository lint, formatting, typecheck, tests and build. Future SQL/adapter implementations must separately match this oracle and pass real adversarial tenant/source tests; query cost, timeouts and read-only permissions remain unverified until then.

## 10. Non-goals, deferred decisions and tradeoffs

No changes to runtime schemas/executors/UI in BRU-483. No PostgreSQL connector, LLM, general SQL planner, financial ledger, persistence/authentication, new dependency, production demo or Darkroom modification, YAML export, CLI, MCP or enterprise semantic layer.

The conservative choices are intentional: separate signed net results preserve v1 semantics; unknown parents and unsupported corrections block complete answers; exact fixture comparison avoids arbitrary materiality; content identities add local reproducibility without pretending to provide authenticated authority.

Deferred questions with boundaries:

- **BRU-463:** finalize strict field-role/catalog schemas, canonicalization test vectors and local evidence file layout; retain the identity and failure semantics here. Determine how the harness manifests required cases/mutations so incomplete reports cannot pass.
- **BRU-461 / future source work:** authenticated tenant resolution, authorized historical-parent lookup and generic unavailable-parent responses, snapshot consistency across sources, completeness watermarks and freshness SLAs. Unknowns stay explicit until evidence exists.
- **Future financial scope:** split payments, FX/tax/discount policy, negative fee credits, reversals and corrections need new reviewed calculation policy IDs and fixtures. V1 rejects unsupported events instead of inventing a ledger.
- **Future reconciliation integration:** choose real controls and documented timing/rounding policies with domain owners. No tolerance is inferred from B+'s percentage; no decision on the unexplained $412 without parent/settlement evidence.
- **BRU-460 / future authority:** durable artifact namespaces/version uniqueness, authenticated review roles, approval revocation, signatures and evidence retention; imported local records continue to require explicit trusted reapproval.
- **BRU-484/467:** portable app-owned artifact packaging, compatibility/migrations, YAML/CLI/MCP ergonomics. Git-reviewable JSON is a feasible direction, not an export implementation in this change.

An implementer can begin with the net fixture and exact comparison report, then add local artifact identity and review linkage. Each increment must retain truthful unknown/not-verified states. No hosted infrastructure is required to represent or test these contracts.
