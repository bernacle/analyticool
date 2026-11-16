import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { createServerClient } from "@supabase/ssr";
import { createCookieJar } from "./cookie-policy";

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
}>;

export type SessionServer = Readonly<{
  origin: string;
  origins: readonly string[];
  /** Cookie writes attempted after a response was committed (must stay empty). */
  violations: () => readonly string[];
  close: () => Promise<void>;
}>;

const SAFE_REDIRECTS = new Set(["/me", "/login"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/**
 * ADR §2 absolute login lifetime, from the signed `amr` login timestamp in
 * verified claims (GoTrue preserves it across refresh). Missing/invalid → deny.
 */
export function exceedsAbsoluteLifetime(
  claims: Readonly<Record<string, unknown>>,
  nowSeconds: number,
  absoluteLifetimeSeconds: number,
): boolean {
  const amr = Array.isArray(claims.amr) ? claims.amr : [];
  const stamps = amr
    .map((entry: unknown) => (entry as { timestamp?: unknown })?.timestamp)
    .filter((t): t is number => typeof t === "number" && t > 0);
  if (stamps.length === 0) return true;
  return nowSeconds >= Math.min(...stamps) + absoluteLifetimeSeconds;
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
    const jar = createCookieJar(req.headers.cookie, {
      storageKey: options.storageKey,
      secure: options.secure,
      absoluteLifetimeSeconds: options.absoluteLifetimeSeconds,
    });
    const supabase = createServerClient(
      options.apiUrl,
      options.publishableKey,
      {
        cookies: jar.methods,
        cookieOptions: { name: options.storageKey },
      },
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

    /** getClaims (signature/exp) + issuer/audience + getUser (current account). */
    async function authenticate() {
      const { data, error } = await supabase.auth.getClaims();
      if (error || !data) return null;
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
        return null;
      if (
        exceedsAbsoluteLifetime(
          claims,
          Math.floor(Date.now() / 1000),
          options.absoluteLifetimeSeconds,
        )
      )
        return null;
      const user = await supabase.auth.getUser();
      if (user.error || user.data.user?.id !== claims.sub) return null;
      return { subject: claims.sub, sessionId: claims.session_id };
    }

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
          const { error } = await supabase.auth.signOut({ scope: "local" });
          confirmed = !error;
        } catch {
          confirmed = false;
        }
        // Always clear every chunk the browser holds, even if Auth was unreachable.
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
