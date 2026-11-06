import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fixture from "./bru-482.fixture.json";
import oracle from "./bru-482.expected.json";
import {
  netReceiptsDefinition,
  netReceiptsInputSchema,
  netReceiptsPeriod,
  type NetReceiptsInput,
} from "../../packages/core/src/net-receipts";
import {
  compareCase,
  freshInput,
  incorrectCalculator,
  mutationIds,
  verificationCases,
} from "./suite";

export const digestBytes = (bytes: string | Buffer) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
// Bounded schema serialization, NOT a general-purpose canonical JSON implementation.
// Zod fixes property order; each stream has unique IDs and sorts by ordinal ID.
export function snapshotDigest(input: NetReceiptsInput): string {
  const parsed = netReceiptsInputSchema.parse(input);
  for (const key of ["charges", "payments", "refunds", "fees"] as const) {
    if (
      new Set(parsed[key].rows.map((r) => r.id)).size !==
      parsed[key].rows.length
    )
      throw new Error("Duplicate snapshot IDs.");
    parsed[key].rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return digestBytes(JSON.stringify(parsed));
}
const implementationPaths = [
  "packages/core/src/net-receipts.ts",
  "verification/net-receipts/evidence.ts",
  "verification/net-receipts/suite.ts",
  "verification/net-receipts/oracle.py",
  "scripts/verify-net-receipts.mjs",
  "package.json",
  "packages/core/package.json",
  "pnpm-lock.yaml",
  "tsconfig.base.json",
  ".nvmrc",
].sort();
export function buildEvidence(root: string) {
  const ref = (path: string) => ({
    path,
    encoding: "raw-file-bytes" as const,
    digest: digestBytes(readFileSync(resolve(root, path))),
  });
  const implementation = {
    policy: netReceiptsDefinition.calculation,
    runtime: process.version,
    files: implementationPaths.map(ref),
  };
  const cases = verificationCases().map((c) => ({
    inputDigest: digestBytes(JSON.stringify(c.input)),
    inputEncoding: "generated-case-json-v1; replay pinned suite to reconstruct",
    ...compareCase(c),
  }));
  if (!cases.length || new Set(cases.map((c) => c.id)).size !== cases.length)
    throw new Error("Missing or duplicate cases.");
  const baseline = verificationCases()[0]!;
  const mutations = mutationIds.map((id) => {
    const comparison = compareCase(baseline, incorrectCalculator(id));
    return {
      mutation: id,
      inputDigest: digestBytes(JSON.stringify(baseline.input)),
      ...comparison,
      detected:
        comparison.status === "failed" &&
        comparison.actual.kind === "completed" &&
        comparison.assertions.some(
          (a) => a.status === "failed" && a.path !== "kind",
        ),
    };
  });
  const passed =
    cases.every((c) => c.status === "passed") &&
    mutations.every((m) => m.detected);
  // Keep exact failed comparisons and the paths of successful assertions; values
  // are already recorded in each case's expected/actual outcomes.
  const record = <T extends ReturnType<typeof compareCase>>(comparison: T) => ({
    ...comparison,
    assertions: {
      passed: comparison.assertions
        .filter((a) => a.status === "passed")
        .map((a) => a.path),
      failed: comparison.assertions.filter((a) => a.status === "failed"),
    },
  });
  return {
    schemaVersion: 1,
    method: "bounded-local-independent-fixture-comparison",
    serialization:
      "fixed-schema-json-v1; file references hash raw bytes; input rows sorted by unique stream ID",
    definition: {
      metricId: netReceiptsDefinition.id,
      metricVersion: netReceiptsDefinition.version,
      digest: digestBytes(JSON.stringify(netReceiptsDefinition)),
      value: netReceiptsDefinition,
    },
    implementation: {
      digest: digestBytes(JSON.stringify(implementation)),
      ...implementation,
    },
    fixture: {
      ...ref("verification/net-receipts/bru-482.fixture.json"),
      sourceId: fixture.sourceId,
      inputDigest: snapshotDigest(freshInput()),
    },
    expected: {
      ...ref("verification/net-receipts/bru-482.expected.json"),
      independence: oracle.provenance,
      rationale: oracle.rationale,
    },
    oracle: ref("verification/net-receipts/oracle.py"),
    scope: {
      tenantId: "acme",
      enforcement: "local-policy-over-caller-supplied-rows",
      asOf: "2026-07-01",
      ...netReceiptsPeriod("2026-07-01"),
      currency: "USD",
      sourceCompleteness: "caller-declared-only",
      productionFreshness: "unknown",
    },
    toleranceCents: 0,
    cases: cases.map(record),
    mutations: mutations.map(record),
    status: passed ? "passed" : "failed",
    statement: passed
      ? "Synthetic fixture checks passed. Production data has not been verified."
      : "Synthetic fixture checks failed. Production data has not been verified.",
    limitations: [
      "Only the pinned synthetic inputs, handwritten expectations, declared cases and implementation were compared; matching them does not prove all financial cases correct.",
      "The separately executable Python oracle corroborates the baseline, not production; the Node runner does not execute Python.",
      "No live connector, PostgreSQL isolation, source completeness, snapshot consistency, freshness, read-only permissions, query cost or timeouts tested.",
      "No durable authenticated approval, artifact import authority, generic canonical JSON, version registry or payout reconciliation implemented.",
      "Hashes identify local content relative to a known reference; they do not authenticate its author or grant access.",
      "Reversals, corrections, split captures, FX, tax subtraction, proration, fee credits and accounting revenue recognition are unsupported.",
    ],
  };
}
