# Operational net receipts: bounded local verification

BRU-463, first increment. Design reference: [BRU-483 ADR](metric-provenance.md), merged in [PR #5](https://github.com/bernacle/analyticool/pull/5) before this implementation. The ADR remains the intended broader contract; its proposed artifact/approval/reconciliation system is not implemented by this increment.

**Operational net receipts = captured payments − settled refunds − posted processing fees.** All amounts are integer USD cents. This is an operational event metric, not GAAP/recognized revenue, MRR, processor payouts, or cash in a bank account.

## Calculation and result

`calculateNetReceipts(netReceiptsDefinition, input)` is a pure, deterministic API exported by `@analyticool/core`. The definition has metric ID `operational-net-receipts`, version `1`, and closed calculation policy `captured-minus-settled-refunds-minus-posted-fees-v1`. Strict Zod schemas validate the definition, each source, input, and result. There is no formula evaluator, SQL, IO, clock read, or proposal-lifecycle change.

`asOf` is an explicit ISO date. Use the six complete UTC calendar months before its month; exclude the current partial month. The period is start-inclusive/end-exclusive. Timestamps must be valid ISO instants with `Z` or a numeric offset. Convert to UTC before choosing a month. Supported as-of dates are `0001-07-01` through `9999-12-31`, keeping period labels within four-digit years.

Each event belongs to its **own** effective month:

- Original captured payment → `capturedAt`; full amount from its charge.
- Original settled refund → `settledAt`; actual refund amount, including partial refunds.
- Original posted processing fee → `postedAt`; actual fee amount.

A December capture can have a January refund. Retain the captured payment and its charge for parent lookup even when the capture is outside the report window. Later refunds do not erase or move the original capture. Aggregate the three streams independently, then combine by month, avoiding refund × fee join fan-out. Multiple refunds and fees per captured payment are supported.

Failed/pending rows contribute nothing. Their timestamp may be null or an observed candidate instant; it is ignored until the status becomes effective. Effective rows require a non-null timestamp. `asOf` selects the reporting period, **not** the time data was observed. A later snapshot can legitimately change an earlier period's result; the previous result and report are not mutated.

Every monthly point contains `month`, nonnegative `capturedCents`, `settledRefundCents`, `postedFeeCents`, and signed `netCents`. `totals` has the same four amount fields across the full period. The result also carries metric ID/version, tenant, as-of date, currency, timezone and exact period endpoints. March's negative result is valid in this contract. Existing collected-revenue schemas, calculation, proposals and React components are unchanged and still reject negative collected values.

All accumulation and subtraction use `bigint`; only safe integers are exposed as numbers. Reject overflow of any monthly component, monthly net, grand component or grand net, even when subtraction would produce a safe-looking answer. Result validation independently checks each net equation and all four grand totals exactly. No rounding, clamping, percentage tolerance or currency conversion occurs.

## Required source contract

The exact exported contract is `NetReceiptsInput` / `netReceiptsInputSchema`. No extra fields or implicit defaults are accepted. IDs and tenant labels are nonempty strings without surrounding whitespace; IDs are unique within each source, including out-of-period, excluded-status and foreign rows. Different sources may use the same ID.

| Input/stream   | Required fields                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input          | `asOf`, `tenantId`, `charges`, `payments`, `refunds`, `fees`                                                                                                              |
| Every stream   | `completeness: "declared-complete" \| "incomplete" \| "unknown"`, `rows` array                                                                                            |
| Charge         | `id`, `tenantId`, nonnegative safe integer `amountCents`, `currency: "USD"`                                                                                               |
| Payment        | `id`, `chargeId`, `eventType`, `status: "captured" \| "pending" \| "failed"`, nullable `capturedAt`                                                                       |
| Refund         | `id`, `tenantId`, `paymentId`, `eventType`, nonnegative safe integer `amountCents`, `currency: "USD"`, `status: "settled" \| "pending" \| "failed"`, nullable `settledAt` |
| Processing fee | `id`, `tenantId`, `paymentId`, `eventType`, nonnegative safe integer `amountCents`, `currency: "USD"`, `status: "posted" \| "pending" \| "failed"`, nullable `postedAt`   |

`eventType` is `"original" | "reversal" | "correction"`. Original events are executable; an explicit reversal/correction belonging to the selected tenant blocks the result, regardless of its status or date in the supplied snapshot. Unknown event types/statuses also fail validation. This conservative snapshot-wide policy prevents unsupported history from disappearing behind report-window filtering.

Every payment must resolve to a supplied charge, since payments inherit their tenant and amount from charges. Scope payments through their charge. Scope refunds and fees independently by their own tenant **before** parent lookup, then require the referenced payment's charge to belong to the selected tenant. All selected-tenant adjustments require a known same-tenant parent, including failed/pending and out-of-period rows. Effective adjustments require a captured parent. A missing historical parent blocks the result; it is never silently inner-joined away. Foreign adjustments referencing an Acme payment are excluded for Acme before lookup. Selected-tenant adjustments referencing a known foreign parent reject explicitly.

The bounded contract allows one full captured payment per charge in the supplied selected-tenant history. Multiple captures for a charge reject; split captures and attempts to infer partial capture amounts are unsupported. Charges without payments do not count. The calculator does not validate a full financial ledger, cumulative refund entitlement, temporal ordering between captures/adjustments, or processor balances. Callers must supply original, deduplicated event facts and a truthful status mapping; labeling a reversal as an original debit cannot be detected from these fields.

All four streams must be present and `declared-complete` before a result can be returned. An explicitly empty complete stream is distinct from a missing, incomplete or unknown stream. Only complete declared inputs permit zero months. The declaration must cover the reporting window **and required historical parents**; it is the caller's assertion, not proof of production extraction completeness. Every supplied row must conform to the schema even if it would later be excluded by scope/status.

`NetReceiptsCalculationError.code` provides stable blocking categories:

| Code                  | Meaning                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `INVALID_INPUT`       | Invalid/unsupported definition, shape, amount, currency, date, status or event type; missing stream |
| `INCOMPLETE_STREAM`   | A required stream is not declared complete                                                          |
| `DUPLICATE_ID`        | Repeated ID within any source, including conflicting copies                                         |
| `UNKNOWN_CHARGE`      | Payment has no supplied charge; ownership/amount cannot be established                              |
| `UNKNOWN_PAYMENT`     | Selected-tenant adjustment has no supplied payment parent                                           |
| `CROSS_TENANT_PARENT` | Selected-tenant adjustment references a known foreign payment                                       |
| `NONCAPTURED_PARENT`  | Effective adjustment references a failed/pending payment                                            |
| `MULTIPLE_CAPTURES`   | More than one captured payment for a selected-tenant charge                                         |
| `UNSUPPORTED_EVENT`   | Selected-tenant reversal/correction                                                                 |
| `UNSAFE_CENTS`        | An exposed aggregate would exceed safe integer cents                                                |

No complete result is returned after a blocking error. When several problems coexist, the first encountered issue is reported; successful values are independent of input order. These diagnostics and tenant labels grant no data-access authority.

## Research fixture and independent expectations

The [fixture](../../verification/net-receipts/bru-482.fixture.json) materializes **all** rows from the [BRU-482 Python appendix](../research/competitors/quill-vs-analyticool.md#reproduction-appendix): eight charges, seven payments, seven refunds, six fees, two organizations and three users. Users remain research integrity context, outside the arithmetic API. The synthetic source maps `organization_id` → `tenantId`, `amount_cents` → `amountCents`, `charge_id` → `chargeId`, `payment_id` → `paymentId`, and payment `paid_at` → `capturedAt`. Unnamed adjustment timestamps become `settledAt`/`postedAt`. The research's fee status **settled maps to posted for this fixture only**; this is recorded in the hashed fixture. No generic provider status mapping is inferred.

The [handwritten expectations and rationale](../../verification/net-receipts/bru-482.expected.json) are separate from the calculator. The [Python standard-library oracle](../../verification/net-receipts/oracle.py) independently replays these materialized rows using integer arithmetic and UTC datetime conversion, checks the organization/user ownership context, and compares to those expectations. It imports no candidate helpers. Shared assumptions in the research may still be wrong; independence here means separate arithmetic implementations and expectations, not external financial certification.

`asOf = 2026-07-01`, tenant `acme`, period `[2026-01-01T00:00:00Z, 2026-07-01T00:00:00Z)`:

| Month    | Captured | Settled refunds | Posted fees | Net cents |
| -------- | -------: | --------------: | ----------: | --------: |
| January  |    10000 |            3000 |         350 |      6650 |
| February |    20000 |            1500 |         600 |     17900 |
| March    |        0 |            2000 |           0 |     -2000 |
| April    |        0 |               0 |           0 |         0 |
| May      |        0 |               0 |           0 |         0 |
| June     |    30000 |               0 |         900 |     29100 |
| Total    |    60000 |            6500 |        1850 | **51650** |

## Reproduce and inspect the evidence

From a clean checkout, use the exact toolchain in `.nvmrc` (Node 24.21.0) and `package.json` (pnpm 10.34.9):

```sh
nvm use
pnpm install --frozen-lockfile
pnpm verify:net-receipts
python3 verification/net-receipts/oracle.py
pnpm test
pnpm lint
pnpm format:check
pnpm typecheck
pnpm build
```

The verification command replays the candidate, all 75 declared cases and seven deliberately incorrect arithmetic variants, then compares the entire generated report byte-for-byte with [report.json](../../verification/net-receipts/report.json). It fails on a mismatch or unexpected rejection, and on a surviving mutation. It also rejects a stale/tampered report or a changed pinned code/input/expectation file. It uses the existing Vitest/Vite TypeScript loader in middleware mode, with no HTTP listener or new dependency. CI runs this replay and the separate Python oracle.

After an intentional implementation or test change, inspect it and explicitly run `pnpm verify:net-receipts --write` to replace the candidate report. This never regenerates expected values. Review changes to expectations independently; do not bless calculator output by copying it into the oracle. Normal replay does not write files or rewrite history.

The report records the exact definition and digest; an implementation manifest with raw source, harness, oracle, runtime, package/lockfile and compiler-option identities; the fixture and handwritten expectation file identities; normalized input identity; tenant and period; each case's expected and actual outcome; passing assertion paths and failed expected/actual comparisons; and the failed numerical comparisons for each detected mutation. Each generated case input has a digest and can be reconstructed from the pinned fixture and suite. Reported negative cases must match the specific blocking code; an arbitrary exception does not pass. A killed mutation is recorded as a **failed** oracle comparison, even though detecting it satisfies the mutation check.

Raw files use SHA-256 over exact bytes. Definition identity hashes UTF-8 `JSON.stringify` of the fixed, flat, schema-parsed definition in declared property order. Snapshot identity hashes `JSON.stringify` of schema-parsed input, sorting each stream by its unique ID using ordinal comparisons; schema property order is fixed, stream completeness/tenant/period are included, and caller inputs are not mutated. Delivery order changes do not alter this normalized input identity. Raw fixture/harness byte identities still change when their files are reordered or reformatted. Implementation identity hashes the fixed-order manifest, including exact Node version and sorted file references. The report's own digest is printed over its exact stored bytes, outside the report, avoiding a self-reference. No run timestamps or absolute checkout paths enter the report; repeated runs on the pinned checkout/toolchain reproduce the same bytes and identities.

These are **bounded, schema-specific encodings**, not the ADR's generic `canonical-json-v1` contract. No generic JSON importer, duplicate-key ingestion validator, artifact resolver, untrusted approval importer or portable report applicability API is claimed. The current replay accepts only the checked-in, fixed-path artifacts and reconstructs the whole report. A content hash detects differences relative to a known reference; it does not authenticate authorship, completeness or approval.

The passing report states:

**Synthetic fixture checks passed. Production data has not been verified.**

## What is established and what remains

The declared cases exercise exact monthly components and totals; partial/multiple/historical refunds; independent tenant filtering and both ownership directions for refunds/fees; unknown/noncaptured parents; failed/pending events; inclusive/exclusive UTC offset boundaries; negative months; duplicate/conflicting IDs in every source; unsafe monthly/grand components and signed totals; missing/incomplete/unknown/explicitly empty sources; unsupported correction/reversal events; and reversed delivery order. Additional contract tests cover invalid timestamps/nulls, strict fields, invalid results, leap day, year rollover, safe-integer limits, preserved snapshots and v1 compatibility.

Seven incorrect variants must fail the independent numerical expectations: refund in capture month, raw join fan-out, timestamp-prefix/local date bucketing, pending inclusion, negative clamping, scoping only payments, and dropping refunds with old parents. Correct grand totals cannot excuse wrong monthly components. These checks establish behavior for the pinned cases; they are not a general proof.

**No PostgreSQL or production tenant isolation was tested.** `tenantId` is caller-supplied scope, not authentication. Source freshness remains unknown, completeness is caller-declared, and no processor payout or independent production control was reconciled. There is no approval or production-verification badge, SDK release or React integration for this new result.

Keep BRU-463 **In Progress**, not Done: this useful first increment intentionally does not satisfy the entire ADR matrix. Proposed follow-up split:

1. **Portable evidence and review linkage:** implement/freeze generic canonical JSON test vectors and duplicate-key ingestion, strict catalog/binding and artifact schemas, content resolution/applicability checks across definition/implementation/fixture/tenant/period, same-version conflicts, and locally reviewed fixture-verified publication with truthful imported-authority limitations. Preserve existing lifecycle history; no retrospective approval. This needs a dedicated PR rather than a partial artifact framework here.
2. **Bounded reconciliation controls:** independently authored same-basis controls and documented timing bridges, exact residual checks, and explicit matched/explained/unexplained/inconclusive cases. Synthetic controls must remain labeled synthetic; no processor-payout claims.
3. **BRU-461 / live connector validation:** authorized historical-parent queries, adversarial real-source tenant isolation, snapshot consistency, null/status/currency mapping, extraction completeness and freshness watermarks, schema changes, read-only permissions, cost/timeouts, and the same independent financial oracle. Runtime/cost benchmarks require a real executable connector. Durable authenticated approval/storage and generic planning remain separate infrastructure work.

Unsupported financial scope includes split captures, reversals/corrections, negative fee credits, FX/multiple currencies, tax subtraction, proration, disputes/holds/reserves and GAAP recognition. Adding any requires an intentional new policy and independently reviewed fixtures; none is silently approximated by this calculation.
