// Gate-negative checks for scripts/assert-auth-metadata-report.mjs (BRU-492
// preparation). Given a PASSING Vitest JSON report of the auth-metadata suite,
// proves the gate accepts it and rejects every way the evidence can silently
// degrade: a missing suite file, a skipped/todo/failed case, a dropped count,
// an unsuccessful run, an unreadable report, and a real run of the suite with
// its configuration removed (which must fail, not skip).
//
// Usage: node scripts/check-auth-metadata-gate.mjs <passing-report.json>
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { deserialize, serialize } from "node:v8";

const gate = fileURLToPath(
  new URL("./assert-auth-metadata-report.mjs", import.meta.url),
);
const passingPath = process.argv[2];
if (!passingPath) {
  process.stderr.write(
    "usage: check-auth-metadata-gate.mjs <passing-report.json>\n",
  );
  process.exit(2);
}
const passing = JSON.parse(readFileSync(passingPath, "utf8"));
const dir = mkdtempSync(join(tmpdir(), "auth-metadata-gate-"));
const runGate = (path) =>
  spawnSync(process.execPath, [gate, path], { encoding: "utf8" }).status;
const clone = () => deserialize(serialize(passing));
const firstAssertion = (r) => r.testResults[0].assertionResults[0];

const mutations = {
  "missing suite file": (r) => {
    r.testResults = r.testResults.filter(
      (t) => !t.name.endsWith("auth-session.test.ts"),
    );
  },
  "skipped case": (r) => {
    firstAssertion(r).status = "skipped";
    r.numPassedTests -= 1;
    r.numPendingTests += 1;
  },
  "todo case": (r) => {
    firstAssertion(r).status = "todo";
    r.numPassedTests -= 1;
    r.numTodoTests += 1;
  },
  "failed case": (r) => {
    firstAssertion(r).status = "failed";
    r.testResults[0].status = "failed";
    r.numPassedTests -= 1;
    r.numFailedTests += 1;
    r.success = false;
  },
  "dropped case (below floor)": (r) => {
    r.testResults[0].assertionResults.pop();
    r.numPassedTests -= 1;
    r.numTotalTests -= 1;
  },
  "unsuccessful run flag": (r) => {
    r.success = false;
  },
};

const problems = [];
let checks = 0;
const expectStatus = (label, path, want) => {
  checks += 1;
  const got = runGate(path);
  const ok = want === 0 ? got === 0 : got !== 0;
  process.stdout.write(
    `gate-negative: ${ok ? "ok  " : "FAIL"} ${label} (exit ${got})\n`,
  );
  if (!ok) problems.push(label);
};

try {
  const base = join(dir, "passing.json");
  writeFileSync(base, JSON.stringify(passing));
  expectStatus("passing report accepted", base, 0);
  for (const [label, mutate] of Object.entries(mutations)) {
    const report = clone();
    mutate(report);
    const path = join(dir, `${label.replace(/\W+/g, "-")}.json`);
    writeFileSync(path, JSON.stringify(report));
    expectStatus(`rejects ${label}`, path, 1);
  }
  const garbage = join(dir, "garbage.json");
  writeFileSync(garbage, "not json");
  expectStatus("rejects unreadable report", garbage, 1);
  expectStatus("rejects missing report", join(dir, "absent.json"), 1);

  // A real run with the stack configuration removed must fail, and its report
  // must also be rejected by the gate.
  const env = { ...process.env };
  for (const k of Object.keys(env))
    if (k.startsWith("ANALYTICOOL_AUTH_TEST_")) delete env[k];
  const unconfigured = join(dir, "unconfigured.json");
  const run = spawnSync(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "--config",
      "verification/auth-metadata/vitest.config.ts",
      "--reporter=json",
      `--outputFile.json=${unconfigured}`,
    ],
    { encoding: "utf8", env },
  );
  checks += 1;
  const runFailed = run.status !== 0;
  process.stdout.write(
    `gate-negative: ${runFailed ? "ok  " : "FAIL"} unconfigured suite run fails (exit ${run.status})\n`,
  );
  if (!runFailed) problems.push("unconfigured suite run did not fail");
  expectStatus("rejects unconfigured run report", unconfigured, 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (problems.length > 0) {
  process.stderr.write(`gate-negative: FAILED\n- ${problems.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(`gate-negative: OK, ${checks} checks\n`);
