// Fail-closed gate for the BRU-492 preparation suite (real local Supabase Auth
// + PostgreSQL) in CI and operator checks.
//
// The suite already throws without its configuration, but `vitest run` can
// still exit 0 for skipped/todo cases or a filtered run. This script reads the
// Vitest JSON report and fails unless every expected suite file ran, every
// test passed, nothing was skipped or marked todo, and the counts did not drop
// below the recorded floor. Raise floors when cases are added; lowering one is
// a deliberate, reviewed change to the security evidence.
//
// Usage: node scripts/assert-auth-metadata-report.mjs <vitest-report.json>
import { readFileSync } from "node:fs";
import process from "node:process";

const out = (line) => process.stdout.write(`${line}\n`);
const err = (line) => process.stderr.write(`${line}\n`);

// auth-predicate-gate: historical, REJECTED Auth-table predicate diagnostics
// (kept as evidence, never an active application owner); its floor stays.
export const MIN_TESTS_PER_FILE = {
  "verification/auth-metadata/auth-session.test.ts": 43,
  "verification/auth-metadata/auth-predicate-gate.test.ts": 6,
  "verification/auth-metadata/metadata-rls.test.ts": 26,
};
const MIN_TOTAL = Object.values(MIN_TESTS_PER_FILE).reduce((a, b) => a + b, 0);

const reportPath = process.argv[2];
if (!reportPath) {
  err("usage: assert-auth-metadata-report.mjs <vitest-report.json>");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (error) {
  err(`auth-metadata: cannot read report ${reportPath}: ${error.message}`);
  process.exit(1);
}

const problems = [];
const results = Array.isArray(report.testResults) ? report.testResults : [];
const normalize = (name) => String(name).replaceAll("\\", "/");

for (const [file, minimum] of Object.entries(MIN_TESTS_PER_FILE)) {
  const entry = results.find((r) => normalize(r.name).endsWith(`/${file}`));
  if (!entry) {
    problems.push(`${file}: missing from the report (suite not run)`);
    continue;
  }
  const assertions = entry.assertionResults ?? [];
  const passed = assertions.filter((a) => a.status === "passed").length;
  const notPassed = assertions.filter((a) => a.status !== "passed");
  if (entry.status !== "passed")
    problems.push(`${file}: file status ${entry.status}`);
  if (notPassed.length > 0)
    problems.push(
      `${file}: ${notPassed.length} test(s) not passed (${[...new Set(notPassed.map((a) => a.status))].join(", ")})`,
    );
  if (passed < minimum)
    problems.push(`${file}: ${passed} passed, expected at least ${minimum}`);
  out(`auth-metadata: ${file}: ${passed} passed`);
}

const counts = {
  total: report.numTotalTests,
  passed: report.numPassedTests,
  failed: report.numFailedTests,
  pending: report.numPendingTests,
  todo: report.numTodoTests,
};
if (report.success !== true) problems.push("report success is not true");
if (counts.failed !== 0) problems.push(`${counts.failed} failed test(s)`);
if (counts.pending !== 0) problems.push(`${counts.pending} skipped test(s)`);
if (counts.todo !== 0) problems.push(`${counts.todo} todo test(s)`);
if (counts.passed !== counts.total)
  problems.push(`${counts.passed}/${counts.total} tests passed`);
if (!(counts.passed >= MIN_TOTAL))
  problems.push(`${counts.passed} passed, expected at least ${MIN_TOTAL}`);

if (problems.length > 0) {
  err(`auth-metadata: FAILED\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
out(
  `auth-metadata: OK, ${counts.passed}/${counts.total} passed, 0 skipped, 0 failed (floor ${MIN_TOTAL})`,
);
