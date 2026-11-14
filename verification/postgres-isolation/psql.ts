import { spawn } from "node:child_process";

/**
 * Minimal psql (16+) process runner: no new dependency. Credentials go through
 * PG* environment variables (never argv, URLs or the script). The child gets a
 * clean environment so ambient PGSERVICE/PGOPTIONS/psqlrc cannot alter it.
 */
export type PsqlTarget = Readonly<{
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslmode: string;
  sslrootcert?: string | undefined;
}>;

export type PsqlRun = Readonly<{
  exitCode: number | null;
  /** Server SQLSTATE of the first error, when psql reported one. */
  sqlstate: string | null;
  stdout: string;
  /** Diagnostics for trusted test bootstrap only; executors never surface it. */
  stderr: string;
  timedOut: boolean;
}>;

export async function runPsql(
  target: PsqlTarget,
  script: string,
  options: {
    variables?: Readonly<Record<string, string>>;
    timeoutMs?: number;
    /** Full server messages; only for trusted admin bootstrap diagnostics. */
    verbose?: boolean;
  } = {},
): Promise<PsqlRun> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    PGHOST: target.host,
    PGPORT: String(target.port),
    PGDATABASE: target.database,
    PGUSER: target.user,
    PGPASSWORD: target.password,
    PGSSLMODE: target.sslmode,
    PGCONNECT_TIMEOUT: "5",
    PGAPPNAME: "analyticool-isolation",
    PGTZ: "UTC",
  };
  if (target.sslrootcert) env.PGSSLROOTCERT = target.sslrootcert;
  const args = [
    "--no-psqlrc",
    "--no-password",
    "--quiet",
    "--no-align",
    "--tuples-only",
    "--field-separator=|",
    "--set=ON_ERROR_STOP=1",
    `--set=VERBOSITY=${options.verbose ? "verbose" : "sqlstate"}`,
  ];
  for (const [name, value] of Object.entries(options.variables ?? {})) {
    if (!/^[a-z][a-z0-9_]*$/.test(name))
      throw new Error("Invalid psql variable name.");
    if (value.length === 0 || /[\r\n]/.test(value))
      throw new Error("psql variables must be non-empty single-line values.");
    args.push(`--set=${name}=${value}`);
  }
  const psql = process.env.ANALYTICOOL_PSQL ?? "psql";
  return new Promise((resolve) => {
    const child = spawn(psql, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 30_000);
    child.stdout
      .setEncoding("utf8")
      .on("data", (chunk: string) => (stdout += chunk));
    child.stderr
      .setEncoding("utf8")
      .on("data", (chunk: string) => (stderr += chunk));
    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      const match = /\b(?:ERROR|FATAL):\s+([0-9A-Z]{5})\b/.exec(stderr);
      resolve({
        exitCode,
        sqlstate: match?.[1] ?? null,
        stdout,
        stderr,
        timedOut,
      });
    };
    child.on("error", () => finish(null));
    child.on("close", (exitCode) => finish(exitCode));
    child.stdin.on("error", () => undefined);
    child.stdin.end(script);
  });
}
