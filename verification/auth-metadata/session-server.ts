import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { createServerClient } from "@supabase/ssr";
import { createCookieJar } from "./cookie-policy";
import { evaluateLoginAge } from "./login-age";

/**
 * BRU-492 preparation: a deliberately tiny server-only session flow over plain
 * node:http, used to verify the ADR §2 cookie design against real Supabase
 * Auth before any Next.js wiring exists. NOT an application route, API or
 * reusable module. The browser receives only HttpOnly cookies and HTML; it
 * never loads a Supabase SDK and never sees a token.
 */
export type SessionServerOptions = Readonly<{
  apiUrl: string;
  publishableKey: string;
  storageKey: string;
  secure: boolean;
  absoluteLifetimeSeconds: number;
  /** Per-call bound on every Auth request the SDK makes (default 5 s). */
  authTimeoutMs?: number;
  /** Test-only transport fault injection; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Test-only decision trace; never receives tokens. */
  trace?: (event: AuthTraceEvent) => void;
}>;

export type SessionServer = Readonly<{
  origin: string;
  origins: readonly string[];
  /** Cookie writes attempted after a response was committed (must stay empty). */
  violations: () => readonly string[];
  close: () => Promise<void>;
}>;

export type AuthTraceEvent =
  | Readonly<{ type: "claims-verified"; subject: string; sessionId: string }>
  | Readonly<{ type: "user-validated"; subject: string; sessionId: string }>
  | Readonly<{ type: "denied"; reason: string }>;

export type Principal = Readonly<{
  subject: string;
  sessionId: string;
  loginAt: number;
  deadline: number;
}>;

type ServerSupabase = ReturnType<typeof createServerClient>;

const SAFE_REDIRECTS = new Set(["/me", "/login"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Bound every SDK Auth request; an aborted/timed-out call is an Auth failure. */
export function boundedAuthFetch(
  base: typeof fetch | undefined,
  timeoutMs: number,
): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeout])
      : timeout;
    return (base ?? globalThis.fetch)(input, { ...init, signal });
  };
}

/** Request-scoped server Supabase client over the hardened cookie jar. */
export function createRequestAuth(
  options: SessionServerOptions,
  cookieHeader: string | undefined,
) {
  const jar = createCookieJar(cookieHeader, {
    storageKey: options.storageKey,
    secure: options.secure,
    absoluteLifetimeSeconds: options.absoluteLifetimeSeconds,
  });
  const supabase = createServerClient(options.apiUrl, options.publishableKey, {
    cookies: jar.methods,
    cookieOptions: { name: options.storageKey },
    global: {
      fetch: boundedAuthFetch(options.fetch, options.authTimeoutMs ?? 5_000),
    },
  });
  return {
    jar,
    supabase,
    authenticate: () => authenticateRequest(supabase, options),
  };
}

/**
 * Accepted ADR §2 (2026-11-16): one protected-operation authentication. Call
 * it again for EVERY protected operation and EVERY retry; never cache its
 * result across requests, and never call it while holding metadata locks.
 *
 * 1. The effective token is the one the request-layer client holds after any
 *    SDK refresh (getSession is used only to obtain it, never as authority).
 * 2. getClaims(token): ES256 signature + exp against the project JWKS; then
 *    issuer, audience, role, UUID subject/session id, non-anonymous.
 * 3. Eight-hour limit from verified password-login amr (login-age.ts).
 * 4. A fresh getUser(token) of that SAME token: GoTrue rejects revoked/missing
 *    sessions, banned and deleted users. Any outage/timeout/5xx denies.
 * 5. The returned user must match the verified subject and be a
 *    non-anonymous email/password account.
 */
export async function authenticateRequest(
  supabase: ServerSupabase,
  options: Pick<
    SessionServerOptions,
    "apiUrl" | "absoluteLifetimeSeconds" | "trace"
  >,
  nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
): Promise<Principal | null> {
  const issuer = `${options.apiUrl}/auth/v1`;
  const deny = (reason: string) => {
    options.trace?.({ type: "denied", reason });
    return null;
  };
  try {
    const { data: held, error: heldError } = await supabase.auth.getSession();
    const token = held.session?.access_token;
    if (heldError || !token) return deny("no-session");

    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data) return deny("claims-unverified");
    const claims = data.claims as Record<string, unknown>;
    if (
      claims.iss !== issuer ||
      claims.aud !== "authenticated" ||
      claims.role !== "authenticated" ||
      typeof claims.sub !== "string" ||
      !UUID.test(claims.sub) ||
      typeof claims.session_id !== "string" ||
      !UUID.test(claims.session_id)
    )
      return deny("claims-mismatch");
    if (claims.is_anonymous !== false) return deny("anonymous-or-unknown");
    const subject = claims.sub;
    const sessionId = claims.session_id;
    options.trace?.({ type: "claims-verified", subject, sessionId });

    const age = evaluateLoginAge(
      claims,
      nowSeconds(),
      options.absoluteLifetimeSeconds,
    );
    if (!age.ok) return deny(`login-age:${age.reason}`);

    const { data: current, error: userError } =
      await supabase.auth.getUser(token);
    const user = current?.user;
    if (userError || !user) return deny("auth-validation-failed");
    if (
      user.id !== subject ||
      user.is_anonymous !== false ||
      user.aud !== "authenticated" ||
      typeof user.email !== "string" ||
      user.app_metadata?.provider !== "email"
    )
      return deny("account-mismatch");
    options.trace?.({ type: "user-validated", subject, sessionId });
    return { subject, sessionId, loginAt: age.loginAt, deadline: age.deadline };
  } catch {
    return deny("auth-error");
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function readForm(req: IncomingMessage): Promise<URLSearchParams | null> {
  if (
    !(req.headers["content-type"] ?? "").startsWith(
      "application/x-www-form-urlencoded",
    )
  )
    return null;
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) return null;
  }
  return new URLSearchParams(body);
}

export async function startSessionServer(
  options: SessionServerOptions,
): Promise<SessionServer> {
  const issuer = `${options.apiUrl}/auth/v1`;
  const violations: string[] = [];
  let origins: string[] = [];

  const sameOrigin = (req: IncomingMessage) =>
    typeof req.headers.origin === "string" &&
    origins.includes(req.headers.origin) &&
    req.headers["sec-fetch-site"] !== "cross-site";

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://placeholder");
    const { jar, supabase, authenticate } = createRequestAuth(
      options,
      req.headers.cookie,
    );

    const send = (status: number, html: string, location?: string) => {
      const { setCookie, headers } = jar.flush();
      violations.push(...jar.violations());
      for (const [name, value] of Object.entries(headers))
        res.setHeader(name, value);
      if (setCookie.length > 0) res.setHeader("Set-Cookie", [...setCookie]);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Content-Type-Options", "nosniff");
      // Not "no-referrer": with it, browsers send `Origin: null` on form POSTs,
      // which defeats Origin-based same-origin checks (observed in Chromium).
      res.setHeader("Referrer-Policy", "same-origin");
      if (location) res.setHeader("Location", location);
      res.statusCode = status;
      res.end(`<!doctype html><title>BRU-492 verification</title>${html}`);
    };

    try {
      if (req.method === "GET" && url.pathname === "/login") {
        return send(
          200,
          `<form method="post" action="/login"><label>Email <input name="email" type="email" autocomplete="username"></label><label>Password <input name="password" type="password" autocomplete="current-password"></label><input type="hidden" name="next" value="/me"><button type="submit">Sign in</button></form>`,
        );
      }
      if (req.method === "POST" && url.pathname === "/login") {
        if (!sameOrigin(req))
          return send(403, "<p>Cross-origin request refused.</p>");
        const form = await readForm(req);
        const email = form?.get("email") ?? "";
        const password = form?.get("password") ?? "";
        if (!email || !password)
          return send(400, "<p>Missing credentials.</p>");
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error)
          return send(
            error.status && error.status < 500 ? 401 : 503,
            "<p>Sign-in failed.</p>",
          );
        const next = form?.get("next") ?? "/me";
        return send(303, "", SAFE_REDIRECTS.has(next) ? next : "/me");
      }
      if (req.method === "GET" && url.pathname === "/me") {
        const principal = await authenticate();
        if (!principal) return send(401, "<p>Not signed in.</p>");
        return send(
          200,
          `<p id="principal" data-subject="${escapeHtml(principal.subject)}" data-session="${escapeHtml(principal.sessionId)}">Signed in.</p><form method="post" action="/logout"><button type="submit">Sign out</button></form>`,
        );
      }
      if (req.method === "POST" && url.pathname === "/logout") {
        if (!sameOrigin(req))
          return send(403, "<p>Cross-origin request refused.</p>");
        let confirmed = false;
        try {
          // getSession is used only to obtain the bearer token, never to grant
          // access. auth-js signOut suppresses 401/403/404 responses, so its
          // error=null cannot establish that GoTrue revoked this session.
          const { data, error } = await supabase.auth.getSession();
          if (!error && data.session?.access_token) {
            const response = await fetch(`${issuer}/logout?scope=local`, {
              method: "POST",
              headers: {
                apikey: options.publishableKey,
                authorization: `Bearer ${data.session.access_token}`,
              },
              signal: AbortSignal.timeout(options.authTimeoutMs ?? 5_000),
              redirect: "error",
            });
            // Pinned GoTrue acknowledges committed revocation with 204.
            // Rejections and ambiguous outcomes remain unconfirmed.
            confirmed = response.status === 204;
            await response.body?.cancel();
          }
        } catch {
          confirmed = false;
        }
        // Clear incoming and refreshed chunks, even if remote revocation failed.
        jar.deleteAllSessionCookies();
        return confirmed
          ? send(303, "", "/login")
          : send(
              502,
              "<p>Signed out locally; server revocation was not confirmed.</p>",
            );
      }
      return send(404, "<p>Not found.</p>");
    } catch {
      // Auth/network failure: deny, never fall back.
      return send(503, "<p>Authentication unavailable.</p>");
    }
  }

  const server = createServer((req, res) => {
    void handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  return {
    origin: origins[0] as string,
    origins,
    violations: () => [...violations],
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
