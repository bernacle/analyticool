/**
 * BRU-492 preparation: fail-closed configuration for the real local Supabase
 * Auth + PostgreSQL suite. Unlike the BRU-461 suite, missing configuration is
 * an error, never a skip. Every endpoint must be loopback: this suite only
 * targets the disposable stack started by stack.sh.
 */
export type StackEnv = Readonly<{
  apiUrl: string;
  publishableKey: string;
  secretKey: string;
  db: Readonly<{
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  }>;
}>;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function loadStackEnv(env: NodeJS.ProcessEnv = process.env): StackEnv {
  const missing = [
    "ANALYTICOOL_AUTH_TEST_API_URL",
    "ANALYTICOOL_AUTH_TEST_DB_URL",
    "ANALYTICOOL_AUTH_TEST_PUBLISHABLE_KEY",
    "ANALYTICOOL_AUTH_TEST_SECRET_KEY",
  ].filter((name) => !env[name]);
  if (missing.length > 0)
    throw new Error(
      `auth-metadata: missing ${missing.join(", ")}. Start the local stack (verification/auth-metadata/stack.sh start) and load its state file; this suite never skips.`,
    );
  const api = new URL(env.ANALYTICOOL_AUTH_TEST_API_URL as string);
  const db = new URL(env.ANALYTICOOL_AUTH_TEST_DB_URL as string);
  for (const [label, url] of [
    ["API", api],
    ["DB", db],
  ] as const)
    if (!LOOPBACK.has(url.hostname))
      throw new Error(`auth-metadata: ${label} endpoint must be loopback.`);
  if (api.protocol !== "http:" || api.pathname !== "/")
    throw new Error("auth-metadata: API URL must be a bare loopback origin.");
  const publishableKey = env.ANALYTICOOL_AUTH_TEST_PUBLISHABLE_KEY as string;
  const secretKey = env.ANALYTICOOL_AUTH_TEST_SECRET_KEY as string;
  if (!publishableKey.startsWith("sb_publishable_"))
    throw new Error("auth-metadata: unexpected publishable key format.");
  if (!secretKey.startsWith("sb_secret_"))
    throw new Error("auth-metadata: unexpected secret key format.");
  return {
    apiUrl: api.origin,
    publishableKey,
    secretKey,
    db: {
      host: db.hostname,
      port: Number(db.port || 5432),
      database: decodeURIComponent(db.pathname.slice(1)) || "postgres",
      user: decodeURIComponent(db.username),
      password: decodeURIComponent(db.password),
    },
  };
}
