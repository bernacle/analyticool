// Fail-closed gate for the BRU-461 real-PostgreSQL isolation suite in CI.
//
// `vitest run` exits 0 when tests are skipped, and the database cases skip
// themselves without ANALYTICOOL_PG_TEST_ADMIN_URL. This script reads the
// Vitest JSON report and fails unless every expected suite file ran, every
// test passed, nothing was skipped or marked todo, and the counts did not
// drop below the recorded floor. Raise the floor when cases are added; lowering
// it is a deliberate, reviewed change to the security evidence.
//
// Usage: node scripts/assert-postgres-isolation-report.mjs <vitest-report.json>
import { readFileSync } from "node:fs";
import process from "node:process";

const out = (line) => process.stdout.write(`${line}\n`);
const err = (line) => process.stderr.write(`${line}\n`);

const MIN_TESTS_PER_FILE = {
  "verification/postgres-isolation/isolation.test.ts": 87,
  "verification/postgres-isolation/executor-script.test.ts": 6,
};
const MIN_TOTAL = Object.values(MIN_TESTS_PER_FILE).reduce((a, b) => a + b, 0);

const reportPath = process.argv[2];
if (!reportPath) {
  err("usage: assert-postgres-isolation-report.mjs <vitest-report.json>");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (error) {
  err(`postgres-isolation: cannot read report ${reportPath}: ${error.message}`);
  process.exit(1);
}

const problems = [];
const results = Array.isArray(report.testResults) ? report.testResults : [];
const normalize = (name) => name.replaceAll("\\", "/");

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
  out(`postgres-isolation: ${file}: ${passed} passed`);
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
  err(`postgres-isolation: FAILED\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
out(
  `postgres-isolation: OK, ${counts.passed}/${counts.total} passed, 0 skipped, 0 failed (floor ${MIN_TOTAL})`,
);
