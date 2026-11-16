import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { chromium, type Browser } from "@playwright/test";
import {
  createChunks,
  stringFromBase64URL,
  stringToBase64URL,
} from "@supabase/ssr";
import { createClient, type Session } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createCookieJar,
  loginDeadlineFromSessionValue,
} from "./cookie-policy";
import {
  evaluateLoginAge,
  FUTURE_CLOCK_TOLERANCE_SECONDS,
  passwordLoginDeadline,
} from "./login-age";
import {
  startSessionServer,
  type AuthTraceEvent,
  type SessionServer,
} from "./session-server";
import { loadStackEnv } from "./stack-env";

/**
 * BRU-492 preparation gate: server-only HttpOnly Supabase session flow against
 * REAL local Supabase Auth (GoTrue v2.197.0) and its PostgreSQL. Fails (never
 * skips) without the stack. Users are operator-created through the Auth admin
 * API with per-run random passwords that are never printed; public signup is
 * disabled. The admin database connection is used only to observe/force Auth
 * session state (test-only), never by the server under test.
 */
const env = loadStackEnv();
const STORAGE_KEY = "sb-analyticool-auth";
const EIGHT_HOURS = 8 * 60 * 60;
const ISSUER = `${env.apiUrl}/auth/v1`;

const admin = createClient(env.apiUrl, env.secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const plainClient = () =>
  createClient(env.apiUrl, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const db = new pg.Client({
  ...env.db,
  application_name: "analyticool-auth-test-observer",
});

type Jar = Map<string, string>;
type ParsedCookie = Readonly<{
  name: string;
  value: string;
  attributes: ReadonlyMap<string, string | true>;
}>;

function parseSetCookie(header: string): ParsedCookie {
  const [pair = "", ...attrs] = header.split(";").map((s) => s.trim());
  const eq = pair.indexOf("=");
  const attributes = new Map<string, string | true>();
  for (const attr of attrs) {
    const i = attr.indexOf("=");
    if (i < 0) attributes.set(attr.toLowerCase(), true);
    else attributes.set(attr.slice(0, i).toLowerCase(), attr.slice(i + 1));
  }
  return {
    name: pair.slice(0, eq),
    value: decodeURIComponent(pair.slice(eq + 1)),
    attributes,
  };
}

const sessionCookies = (res: Response) =>
  res.headers
    .getSetCookie()
    .map(parseSetCookie)
    .filter((c) => c.name.startsWith(STORAGE_KEY));

function applyCookies(jar: Jar, res: Response) {
  for (const cookie of res.headers.getSetCookie().map(parseSetCookie)) {
    if (cookie.attributes.get("max-age") === "0" || cookie.value === "")
      jar.delete(cookie.name);
    else jar.set(cookie.name, cookie.value);
  }
}
const cookieHeader = (jar: Jar) =>
  [...jar].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ");

/** Read the session JSON the browser holds (test-side inspection only). */
function sessionFromJar(jar: Jar): Session & { expires_at: number } {
  const whole = jar.get(STORAGE_KEY);
  let value = whole ?? "";
  if (!whole)
    for (let i = 0; jar.has(`${STORAGE_KEY}.${i}`); i += 1)
      value += jar.get(`${STORAGE_KEY}.${i}`);
  expect(value.startsWith("base64-")).toBe(true);
  return JSON.parse(stringFromBase64URL(value.slice(7)));
}
function writeSessionToJar(jar: Jar, session: object) {
  for (const name of [...jar.keys()])
    if (name.startsWith(STORAGE_KEY)) jar.delete(name);
  for (const chunk of createChunks(
    STORAGE_KEY,
    `base64-${stringToBase64URL(JSON.stringify(session))}`,
  ))
    jar.set(chunk.name, chunk.value);
}
const claimsOf = (jwt: string) =>
  JSON.parse(stringFromBase64URL(jwt.split(".")[1] as string)) as Record<
    string,
    unknown
  > & {
    sub: string;
    session_id: string;
    iat: number;
    exp: number;
    amr: { method: string; timestamp: number }[];
  };

function expectHardenedFlags(cookie: ParsedCookie) {
  expect(cookie.attributes.get("httponly"), cookie.name).toBe(true);
  expect(cookie.attributes.get("secure"), cookie.name).toBe(true);
  expect(cookie.attributes.get("samesite"), cookie.name).toBe("Lax");
  expect(cookie.attributes.get("path"), cookie.name).toBe("/");
  expect(cookie.attributes.has("domain"), cookie.name).toBe(false);
  expect(cookie.attributes.has("expires"), cookie.name).toBe(false);
}

const makePassword = () => `Synthetic-${randomBytes(12).toString("hex")}Aa1`;
type TestUser = { id: string; email: string; password: string };
async function createOperatorUser(
  label: string,
  metadata: object = {},
): Promise<TestUser> {
  const email = `bru492-${label}-${randomBytes(4).toString("hex")}@synthetic.invalid`;
  const password = makePassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { synthetic: true, ...metadata },
  });
  if (error || !data.user)
    throw new Error(`could not create synthetic user: ${error?.code}`);
  return { id: data.user.id, email, password };
}

let server: SessionServer;
const users: TestUser[] = [];
const traces: AuthTraceEvent[] = [];
/** Decision trace of the main server from this point on. */
const traceFrom = () => {
  const mark = traces.length;
  return () => traces.slice(mark);
};
const fetchAs = (path: string, jar: Jar, init: RequestInit = {}) =>
  fetch(`${server.origin}${path}`, {
    redirect: "manual",
    ...init,
    headers: { cookie: cookieHeader(jar), ...(init.headers ?? {}) },
  });
const postForm = (
  path: string,
  jar: Jar,
  form: Record<string, string>,
  origin = server.origin,
) =>
  fetchAs(path, jar, {
    method: "POST",
    body: new URLSearchParams(form).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", origin },
  });
async function login(user: TestUser, jar: Jar = new Map()) {
  const res = await postForm("/login", jar, {
    email: user.email,
    password: user.password,
    next: "/me",
  });
  expect(res.status).toBe(303);
  applyCookies(jar, res);
  return { jar, res };
}
const sessionRow = async (id: string) =>
  (
    await db.query<{ user_id: string; created_at: Date }>(
      "select user_id, created_at from auth.sessions where id = $1",
      [id],
    )
  ).rows[0];

beforeAll(async () => {
  await db.connect();
  server = await startSessionServer({
    apiUrl: env.apiUrl,
    publishableKey: env.publishableKey,
    storageKey: STORAGE_KEY,
    secure: true,
    absoluteLifetimeSeconds: EIGHT_HOURS,
    // Generous only to tolerate a loaded shared test host; the 5 s default
    // and every fail-closed path are exercised separately.
    authTimeoutMs: 20_000,
    trace: (event) => traces.push(event),
  });
});
afterAll(async () => {
  for (const user of users) await admin.auth.admin.deleteUser(user.id);
  await server?.close();
  await db.end();
});

describe("Auth configuration (real GoTrue)", () => {
  it("disables public signup", async () => {
    const { error } = await plainClient().auth.signUp({
      email: `bru492-signup-${randomBytes(4).toString("hex")}@synthetic.invalid`,
      password: makePassword(),
    });
    expect(error?.code).toBe("signup_disabled");
  });

  it("issues ES256 15-minute access tokens with issuer, audience, subject and session id", async () => {
    const user = await createOperatorUser("config");
    users.push(user);
    const { data, error } = await plainClient().auth.signInWithPassword(user);
    expect(error).toBeNull();
    const token = data.session?.access_token as string;
    const header = JSON.parse(
      stringFromBase64URL(token.split(".")[0] as string),
    );
    const claims = claimsOf(token);
    expect(header.alg).toBe("ES256");
    expect(claims.exp - claims.iat).toBe(900);
    expect(claims.iss).toBe(ISSUER);
    expect(claims.aud).toBe("authenticated");
    expect(claims.sub).toBe(user.id);
    expect((await sessionRow(claims.session_id))?.user_id).toBe(user.id);
  });
});

describe("server-only HttpOnly cookie session", () => {
  let user: TestUser;
  const jar: Jar = new Map();
  let loginSession: Session & { expires_at: number };

  beforeAll(async () => {
    user = await createOperatorUser("main");
    users.push(user);
  });

  it("rejects a wrong password without setting cookies", async () => {
    const res = await postForm("/login", new Map(), {
      email: user.email,
      password: makePassword(),
    });
    expect(res.status).toBe(401);
    expect(sessionCookies(res)).toHaveLength(0);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("refuses cross-origin and Origin-less login before contacting Auth", async () => {
    const cross = await postForm(
      "/login",
      new Map(),
      { email: user.email, password: user.password },
      "http://evil.invalid",
    );
    expect(cross.status).toBe(403);
    expect(sessionCookies(cross)).toHaveLength(0);
    const noOrigin = await fetchAs("/login", new Map(), {
      method: "POST",
      body: new URLSearchParams({
        email: user.email,
        password: user.password,
      }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(noOrigin.status).toBe(403);
  });

  it("logs in with only hardened session cookies, an allowlisted redirect and no token in the body", async () => {
    const res = await postForm("/login", jar, {
      email: user.email,
      password: user.password,
      next: "https://evil.invalid/steal",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/me");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const cookies = sessionCookies(res);
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expectHardenedFlags(cookie);
      const maxAge = Number(cookie.attributes.get("max-age"));
      expect(maxAge).toBeLessThanOrEqual(EIGHT_HOURS);
      expect(maxAge).toBeGreaterThan(EIGHT_HOURS - 120);
    }
    applyCookies(jar, res);
    loginSession = sessionFromJar(jar);
    const body = await res.text();
    expect(body).not.toContain(loginSession.access_token);
    expect(body).not.toContain(loginSession.refresh_token);
    expect(server.violations()).toEqual([]);
  });

  it("authenticates /me from cookies: verified subject and session id match the auth.sessions row", async () => {
    const res = await fetchAs("/me", jar);
    expect(res.status).toBe(200);
    const body = await res.text();
    const claims = claimsOf(loginSession.access_token);
    expect(body).toContain(`data-subject="${user.id}"`);
    expect(body).toContain(`data-session="${claims.session_id}"`);
    expect(body).not.toContain(loginSession.access_token);
    expect(sessionCookies(res)).toHaveLength(0); // no refresh needed yet
    expect((await sessionRow(claims.session_id))?.user_id).toBe(user.id);
  });

  it("denies a tampered cookie", async () => {
    const tampered: Jar = new Map(jar);
    const [name, value] = [...tampered].find(([n]) =>
      n.startsWith(STORAGE_KEY),
    ) as [string, string];
    tampered.set(
      name,
      `${value.slice(0, 40)}${value[40] === "A" ? "B" : "A"}${value.slice(41)}`,
    );
    expect((await fetchAs("/me", tampered)).status).toBe(401);
  });

  it("denies tokens forged with an attacker key (same kid) and with alg=none", async () => {
    const [h, p] = loginSession.access_token.split(".") as [string, string];
    const header = JSON.parse(stringFromBase64URL(h));
    const payload = {
      ...claimsOf(loginSession.access_token),
      sub: randomUuid(),
    };
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const body = `${stringToBase64URL(JSON.stringify(header))}.${stringToBase64URL(JSON.stringify(payload))}`;
    const signature = sign("sha256", Buffer.from(body), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    });
    const forged = `${body}.${signature.toString("base64url")}`;
    const none = `${stringToBase64URL(JSON.stringify({ alg: "none", typ: "JWT" }))}.${p}.`;
    for (const token of [forged, none]) {
      const forgedJar: Jar = new Map();
      writeSessionToJar(forgedJar, { ...loginSession, access_token: token });
      expect((await fetchAs("/me", forgedJar)).status).toBe(401);
    }
  });

  it("rejects the real signed token once its 15-minute exp passes (verifier clock advanced; Auth config unchanged)", async () => {
    const verifier = plainClient();
    const issuedAt = claimsOf(loginSession.access_token).iat * 1000;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(issuedAt + 14 * 60_000);
      expect(
        (await verifier.auth.getClaims(loginSession.access_token)).error,
      ).toBeNull();
      vi.setSystemTime(issuedAt + 15 * 60_000 + 1_000);
      const expired = await verifier.auth.getClaims(loginSession.access_token);
      expect(expired.data).toBeNull();
      expect(expired.error?.message).toMatch(/expired/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes in the request layer when the session is due: same session, rotated tokens, lifetime not reset", async () => {
    const before = sessionFromJar(jar);
    const sid = claimsOf(before.access_token).session_id;
    const createdBefore = (await sessionRow(sid))?.created_at.getTime();
    const loginMaxAge = EIGHT_HOURS;
    // Test-only forcing: mark the browser-held session as due so the SDK refreshes now
    // (expires_at is untrusted client state; authority still comes from GoTrue).
    writeSessionToJar(jar, {
      ...before,
      expires_at: Math.floor(Date.now() / 1000) - 60,
    });
    await new Promise((r) => setTimeout(r, 1100)); // distinct iat
    const res = await fetchAs("/me", jar);
    expect(res.status).toBe(200);
    const cookies = sessionCookies(res);
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expectHardenedFlags(cookie);
      if (cookie.attributes.get("max-age") !== "0")
        expect(Number(cookie.attributes.get("max-age"))).toBeLessThan(
          loginMaxAge,
        );
    }
    applyCookies(jar, res);
    const after = sessionFromJar(jar);
    expect(after.access_token).not.toBe(before.access_token);
    expect(after.refresh_token).not.toBe(before.refresh_token);
    const claims = claimsOf(after.access_token);
    expect(claims.session_id).toBe(sid);
    expect(claims.amr).toEqual(claimsOf(before.access_token).amr); // login time preserved
    expect((await sessionRow(sid))?.created_at.getTime()).toBe(createdBefore);
    expect(server.violations()).toEqual([]);
  });

  it("handles simultaneous refresh of one stale session without logging the user out", async () => {
    const current = sessionFromJar(jar);
    const sid = claimsOf(current.access_token).session_id;
    const stale: Jar = new Map();
    writeSessionToJar(stale, {
      ...current,
      expires_at: Math.floor(Date.now() / 1000) - 60,
    });
    const [a, b] = await Promise.all([
      fetchAs("/me", stale),
      fetchAs("/me", stale),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    for (const res of [a, b]) {
      const jarN: Jar = new Map(stale);
      applyCookies(jarN, res);
      const s = sessionFromJar(jarN);
      expect(claimsOf(s.access_token).session_id).toBe(sid);
      expect((await fetchAs("/me", jarN)).status).toBe(200);
    }
    applyCookies(jar, a);
    expect(server.violations()).toEqual([]);
  });

  it("rejects replay of a superseded refresh token after the reuse interval (GoTrue keeps the live chain)", async () => {
    const original = loginSession.refresh_token;
    // The live chain has advanced at least twice since login; wait past the 10 s reuse window.
    await new Promise((r) => setTimeout(r, 11_000));
    const replay = await plainClient().auth.refreshSession({
      refresh_token: original,
    });
    expect(replay.data.session).toBeNull();
    expect(replay.error?.code).toBe("refresh_token_already_used");
    // Observed GoTrue v2.197.0 behaviour: reuse detection does not revoke the session.
    expect((await fetchAs("/me", jar)).status).toBe(200);
  }, 90_000);

  it("caps cookie Max-Age to the remaining absolute lifetime and refuses sessions it cannot bound", () => {
    const amrAt = Math.floor(Date.now() / 1000) - (EIGHT_HOURS - 45);
    const token = (amr: unknown) =>
      `${stringToBase64URL('{"alg":"ES256"}')}.${stringToBase64URL(JSON.stringify({ amr }))}.sig`;
    const value = (amr: unknown) =>
      `base64-${stringToBase64URL(JSON.stringify({ access_token: token(amr), refresh_token: "synthetic" }))}`;
    const write = (v: string) => {
      const j = createCookieJar(undefined, {
        storageKey: STORAGE_KEY,
        secure: true,
        absoluteLifetimeSeconds: EIGHT_HOURS,
      });
      void j.methods.setAll?.(
        [
          {
            name: STORAGE_KEY,
            value: v,
            options: {
              maxAge: 400 * 24 * 3600,
              httpOnly: false,
              domain: "evil.invalid",
              sameSite: "none",
            },
          },
        ],
        {},
      );
      return parseSetCookie(j.flush().setCookie[0] as string);
    };
    const nearEnd = write(value([{ method: "password", timestamp: amrAt }]));
    expectHardenedFlags(nearEnd);
    expect(Number(nearEnd.attributes.get("max-age"))).toBeLessThanOrEqual(45);
    expect(Number(nearEnd.attributes.get("max-age"))).toBeGreaterThan(30);
    for (const unbounded of [
      value([{ method: "password", timestamp: amrAt - 100 }]),
      value(undefined),
      "base64-not-json",
    ]) {
      const cookie = write(unbounded);
      expectHardenedFlags(cookie);
      expect(cookie.attributes.get("max-age")).toBe("0");
      expect(cookie.value === "", `${cookie.name}: cleared value`).toBe(true);
    }
    expect(
      loginDeadlineFromSessionValue(
        value([{ method: "password", timestamp: 1000 }]),
        EIGHT_HOURS,
      ),
    ).toBe(1000 + EIGHT_HOURS);
  });

  it("detects SDK cookie writes after the response is committed", () => {
    const j = createCookieJar(undefined, {
      storageKey: STORAGE_KEY,
      secure: true,
      absoluteLifetimeSeconds: EIGHT_HOURS,
    });
    j.flush();
    expect(() =>
      j.methods.setAll?.([{ name: STORAGE_KEY, value: "x", options: {} }], {}),
    ).toThrow();
    expect(j.violations()).toHaveLength(1);
  });

  it("enforces the 8-hour absolute limit from signed login time (amr) despite refresh", () => {
    const claims = claimsOf(sessionFromJar(jar).access_token);
    const loginAt = Math.min(...claims.amr.map((a) => a.timestamp));
    expect(
      evaluateLoginAge(claims, loginAt + EIGHT_HOURS - 60, EIGHT_HOURS).ok,
    ).toBe(true);
    expect(
      evaluateLoginAge(claims, loginAt + EIGHT_HOURS, EIGHT_HOURS),
    ).toEqual({ ok: false, reason: "expired" });
    expect(
      evaluateLoginAge({ ...claims, amr: [] }, loginAt, EIGHT_HOURS).ok,
    ).toBe(false);
  });
});

describe("absolute lifetime, disablement and logout (real GoTrue)", () => {
  it("denies refresh after the 8-hour timebox (session start backdated, test-only) and clears cookies", async () => {
    const user = await createOperatorUser("timebox");
    users.push(user);
    const { jar } = await login(user);
    const session = sessionFromJar(jar);
    const sid = claimsOf(session.access_token).session_id;
    await db.query(
      "update auth.sessions set created_at = now() - interval '8 hours 1 minute' where id = $1",
      [sid],
    );
    writeSessionToJar(jar, {
      ...session,
      expires_at: Math.floor(Date.now() / 1000) - 60,
    });
    const res = await fetchAs("/me", jar);
    expect(res.status).toBe(401);
    const cleared = sessionCookies(res);
    expect(cleared.length).toBeGreaterThan(0);
    for (const cookie of cleared) {
      expectHardenedFlags(cookie);
      expect(cookie.attributes.get("max-age")).toBe("0");
    }
    const direct = await plainClient().auth.refreshSession({
      refresh_token: session.refresh_token,
    });
    expect(direct.error?.code).toMatch(
      /session_expired|refresh_token_already_used|refresh_token_not_found/,
    );
  });

  it("records the residual: GoTrue /user still accepts an unexpired access token after the timebox", async () => {
    // This changes only database created_at, not the fresh signed amr login
    // time. It proves /user does not enforce that database timebox itself;
    // it does NOT show the application's signed-amr lifetime check failing.
    const user = await createOperatorUser("residual");
    users.push(user);
    const { data } = await plainClient().auth.signInWithPassword(user);
    const token = data.session?.access_token as string;
    await db.query(
      "update auth.sessions set created_at = now() - interval '8 hours 1 minute' where id = $1",
      [claimsOf(token).session_id],
    );
    expect((await plainClient().auth.getUser(token)).error).toBeNull();
  });

  it("denies a disabled (banned) account on the next request and on refresh", async () => {
    const user = await createOperatorUser("banned");
    users.push(user);
    const { jar } = await login(user);
    expect((await fetchAs("/me", jar)).status).toBe(200);
    await admin.auth.admin.updateUserById(user.id, { ban_duration: "876000h" });
    expect((await fetchAs("/me", jar)).status).toBe(401);
    const refresh = await plainClient().auth.refreshSession({
      refresh_token: sessionFromJar(jar).refresh_token,
    });
    expect(refresh.error?.code).toBe("user_banned");
  });

  it("refuses cross-origin logout; same-origin logout revokes the session, clears every chunk and defeats replay", async () => {
    const user = await createOperatorUser("logout");
    users.push(user);
    const { jar } = await login(user);
    const captured = new Map(jar);
    const session = sessionFromJar(jar);
    const sid = claimsOf(session.access_token).session_id;

    const cross = await postForm("/logout", jar, {}, "http://evil.invalid");
    expect(cross.status).toBe(403);
    expect(await sessionRow(sid)).toBeDefined();

    const res = await postForm("/logout", jar, {});
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
    const deleted = sessionCookies(res);
    expect(new Set(deleted.map((c) => c.name))).toEqual(
      new Set([...captured.keys()].filter((n) => n.startsWith(STORAGE_KEY))),
    );
    for (const cookie of deleted) {
      expectHardenedFlags(cookie);
      expect(cookie.attributes.get("max-age")).toBe("0");
    }
    expect(await sessionRow(sid)).toBeUndefined();
    expect((await fetchAs("/me", captured)).status).toBe(401);
    expect(
      (await plainClient().auth.getUser(session.access_token)).error,
    ).not.toBeNull();
    expect(
      (
        await plainClient().auth.refreshSession({
          refresh_token: session.refresh_token,
        })
      ).error?.code,
    ).toBe("refresh_token_not_found");
  });

  it("reports banned-user logout as unconfirmed even though auth-js would suppress its rejection", async () => {
    const user = await createOperatorUser("banned-logout");
    users.push(user);
    const { jar } = await login(user);
    const captured = new Map(jar);
    const session = sessionFromJar(jar);
    const sid = claimsOf(session.access_token).session_id;
    await admin.auth.admin.updateUserById(user.id, { ban_duration: "876000h" });
    try {
      const res = await postForm("/logout", jar, {});
      expect(res.status).toBe(502);
      expect(await res.text()).toContain("revocation was not confirmed");
      expect(await sessionRow(sid)).toBeDefined();
      const deleted = sessionCookies(res);
      expect(deleted.map((c) => c.name).sort()).toEqual(
        [...captured.keys()].filter((n) => n.startsWith(STORAGE_KEY)).sort(),
      );
      for (const cookie of deleted) {
        expectHardenedFlags(cookie);
        expect(cookie.attributes.get("max-age")).toBe("0");
      }
    } finally {
      await admin.auth.admin.updateUserById(user.id, { ban_duration: "none" });
    }
    // The remote session actually survived. Clearing the browser cannot be
    // presented as revoking a captured token: this is precisely the defect.
    expect((await fetchAs("/me", captured)).status).toBe(200);
    expect(
      (
        await plainClient().auth.refreshSession({
          refresh_token: session.refresh_token,
        })
      ).error,
    ).toBeNull();
  });

  it.each([401, 403, 404])(
    "does not treat a rejected logout HTTP %i as confirmed revocation",
    async (status) => {
      const user = await createOperatorUser(`logout-${status}`);
      users.push(user);
      const { jar } = await login(user);
      const sid = claimsOf(sessionFromJar(jar).access_token).session_id;
      const originalFetch = globalThis.fetch;
      const rejectedLogout = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input, init) => {
          if (String(input) === `${ISSUER}/logout?scope=local`)
            return Promise.resolve(new Response("{}", { status }));
          return originalFetch(input, init);
        });
      try {
        const res = await postForm("/logout", jar, {});
        expect(res.status).toBe(502);
        expect(await res.text()).toContain("revocation was not confirmed");
        expect(await sessionRow(sid)).toBeDefined();
        expect(sessionCookies(res).length).toBeGreaterThan(0);
        for (const cookie of sessionCookies(res)) {
          expectHardenedFlags(cookie);
          expect(cookie.attributes.get("max-age")).toBe("0");
        }
      } finally {
        rejectedLogout.mockRestore();
      }
    },
  );
});

/**
 * Test-only provider-state forcing: backdate (or future-date) the disposable
 * Auth authentication-method record of a session BEFORE GoTrue mints the next
 * token, then let the server's request-layer refresh obtain a genuinely
 * GoTrue-signed token carrying that password-login time. No claim is made or
 * signed by the test, and session created_at is left untouched.
 */
async function setAmrAge(sessionId: string, secondsAgo: number) {
  const r = await db.query(
    `update auth.mfa_amr_claims
        set created_at = now() - make_interval(secs => $2),
            updated_at = now() - make_interval(secs => $2)
      where session_id = $1 and authentication_method = 'password'`,
    [sessionId, secondsAgo],
  );
  expect(r.rowCount).toBe(1);
}
const markDue = (jar: Jar) =>
  writeSessionToJar(jar, {
    ...sessionFromJar(jar),
    expires_at: Math.floor(Date.now() / 1000) - 60,
  });
const nowSeconds = () => Math.floor(Date.now() / 1000);
const userCallPath = "/auth/v1/user";
const pathOf = (input: Parameters<typeof fetch>[0]) =>
  new URL(input instanceof Request ? input.url : String(input)).pathname;

describe("eight-hour limit from real GoTrue-signed password-login AMR", () => {
  it("allows a protected request just before eight hours and preserves the signed login time across refreshes", async () => {
    const user = await createOperatorUser("near-8h");
    users.push(user);
    const { jar } = await login(user);
    const sid = claimsOf(sessionFromJar(jar).access_token).session_id;
    await setAmrAge(sid, EIGHT_HOURS - 120);
    markDue(jar);
    const res = await fetchAs("/me", jar);
    expect(res.status).toBe(200);
    for (const cookie of sessionCookies(res)) {
      expectHardenedFlags(cookie);
      const maxAge = Number(cookie.attributes.get("max-age"));
      expect(maxAge).toBeGreaterThan(0);
      expect(maxAge).toBeLessThanOrEqual(120);
    }
    applyCookies(jar, res);
    const minted = claimsOf(sessionFromJar(jar).access_token);
    expect(minted.session_id).toBe(sid);
    expect(minted.amr).toHaveLength(1);
    expect(minted.amr[0]?.method).toBe("password");
    const loginAt = minted.amr[0]?.timestamp as number;
    expect(Math.abs(loginAt - (nowSeconds() - EIGHT_HOURS + 120))).toBeLessThan(
      10,
    );
    expect(minted.iat).toBeGreaterThan(loginAt + EIGHT_HOURS - 200); // fresh token, old login
    // A second refresh keeps the same signed login time.
    await new Promise((r) => setTimeout(r, 1100));
    markDue(jar);
    const again = await fetchAs("/me", jar);
    expect(again.status).toBe(200);
    applyCookies(jar, again);
    expect(claimsOf(sessionFromJar(jar).access_token).amr).toEqual(minted.amr);
  });

  it("denies at eight hours: a freshly refreshed signed token does not restart the deadline, and cookies are cleared", async () => {
    const user = await createOperatorUser("at-8h");
    users.push(user);
    const { jar } = await login(user);
    const sid = claimsOf(sessionFromJar(jar).access_token).session_id;
    await setAmrAge(sid, EIGHT_HOURS - 4);
    markDue(jar);
    const before = await fetchAs("/me", jar);
    expect(before.status).toBe(200);
    applyCookies(jar, before);
    const loginAt = claimsOf(sessionFromJar(jar).access_token).amr[0]
      ?.timestamp as number;
    await new Promise((r) =>
      setTimeout(r, (loginAt + EIGHT_HOURS - nowSeconds() + 1) * 1000),
    );
    const trace = traceFrom();
    expect((await fetchAs("/me", jar)).status).toBe(401);
    expect(trace()).toContainEqual({
      type: "denied",
      reason: "login-age:expired",
    });
    // GoTrue still refreshes (its session row is young), but the new signed
    // token carries the same login time: refresh never extends the limit.
    const direct = await plainClient().auth.refreshSession({
      refresh_token: sessionFromJar(jar).refresh_token,
    });
    expect(direct.error).toBeNull();
    const after = claimsOf(direct.data.session?.access_token as string);
    expect(after.iat).toBeGreaterThanOrEqual(loginAt + EIGHT_HOURS);
    expect(after.amr[0]?.timestamp).toBe(loginAt);
    writeSessionToJar(jar, direct.data.session as Session);
    expect((await fetchAs("/me", jar)).status).toBe(401);
    // A request-layer refresh of an over-age login writes only deletions.
    await new Promise((r) => setTimeout(r, 1100));
    markDue(jar);
    const refreshed = await fetchAs("/me", jar);
    expect(refreshed.status).toBe(401);
    const cleared = sessionCookies(refreshed);
    expect(cleared.length).toBeGreaterThan(0);
    for (const cookie of cleared) {
      expectHardenedFlags(cookie);
      expect(cookie.attributes.get("max-age")).toBe("0");
    }
  }, 90_000);

  it("ignores account last_sign_in_at: only the signed login time matters", async () => {
    const user = await createOperatorUser("last-sign-in");
    users.push(user);
    const { jar } = await login(user);
    await db.query(
      "update auth.users set last_sign_in_at = now() - interval '9 hours' where id = $1",
      [user.id],
    );
    expect((await fetchAs("/me", jar)).status).toBe(200);
  });

  it("denies a GoTrue-signed password login dated beyond the 60 s future tolerance and accepts one within it", async () => {
    const user = await createOperatorUser("future");
    users.push(user);
    for (const [secondsAhead, expected] of [
      [300, 401],
      [20, 200],
    ] as const) {
      const { jar } = await login(user);
      const sid = claimsOf(sessionFromJar(jar).access_token).session_id;
      await setAmrAge(sid, -secondsAhead);
      markDue(jar);
      const trace = traceFrom();
      const res = await fetchAs("/me", jar);
      expect(res.status, `${secondsAhead}s ahead`).toBe(expected);
      if (expected === 401)
        expect(trace()).toContainEqual({
          type: "denied",
          reason: "login-age:future-timestamp",
        });
      else
        for (const cookie of sessionCookies(res))
          expect(Number(cookie.attributes.get("max-age"))).toBeLessThanOrEqual(
            EIGHT_HOURS,
          );
    }
  });

  it("rejects malformed, unsupported and non-integer amr; the future tolerance never extends the deadline", () => {
    const now = 1_800_000_000;
    const at = (amr: unknown) => evaluateLoginAge({ amr }, now, EIGHT_HOURS);
    const reason = (amr: unknown) => {
      const r = at(amr);
      return r.ok ? "ok" : r.reason;
    };
    const pw = (timestamp: unknown) => [{ method: "password", timestamp }];
    expect(reason(undefined)).toBe("missing-amr");
    expect(reason([])).toBe("missing-amr");
    expect(reason("password")).toBe("missing-amr");
    for (const bad of [
      "1800000000",
      1_800_000_000.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      0,
      -5,
      null,
      2 ** 60,
    ])
      expect(reason(pw(bad)), String(bad)).toBe("malformed-amr");
    expect(reason([null])).toBe("malformed-amr");
    expect(reason([{ timestamp: now }])).toBe("malformed-amr");
    expect(reason([{ method: "otp", timestamp: now }])).toBe(
      "unsupported-method",
    );
    expect(reason([...pw(now - 10), { method: "oauth", timestamp: now }])).toBe(
      "unsupported-method",
    );
    expect(reason(pw(now + FUTURE_CLOCK_TOLERANCE_SECONDS))).toBe("ok");
    expect(reason(pw(now + FUTURE_CLOCK_TOLERANCE_SECONDS + 1))).toBe(
      "future-timestamp",
    );
    // Earliest password timestamp wins.
    expect(at([...pw(now - 100), ...pw(now - 5000)])).toEqual({
      ok: true,
      loginAt: now - 5000,
      deadline: now - 5000 + EIGHT_HOURS,
    });
    // A timestamp accepted within the tolerance still expires at exactly ts + 8 h.
    const ts = now + 30;
    expect(
      evaluateLoginAge({ amr: pw(ts) }, ts + EIGHT_HOURS - 1, EIGHT_HOURS).ok,
    ).toBe(true);
    expect(
      evaluateLoginAge({ amr: pw(ts) }, ts + EIGHT_HOURS, EIGHT_HOURS),
    ).toEqual({ ok: false, reason: "expired" });
    expect(evaluateLoginAge({ amr: pw(now) }, Number.NaN, EIGHT_HOURS)).toEqual(
      { ok: false, reason: "invalid-clock" },
    );
    // The cookie adapter uses the same structural rules.
    expect(passwordLoginDeadline({ amr: pw("1") }, EIGHT_HOURS).ok).toBe(false);
  });
});

describe("fresh Auth validation of the same effective token on every request", () => {
  it("calls getUser for every protected request with exactly the verified token, including after refresh; nothing is cached across requests", async () => {
    const bearers: string[] = [];
    const counting = await startSessionServer({
      apiUrl: env.apiUrl,
      publishableKey: env.publishableKey,
      storageKey: STORAGE_KEY,
      secure: true,
      absoluteLifetimeSeconds: EIGHT_HOURS,
      fetch: (input, init) => {
        if (pathOf(input) === userCallPath)
          bearers.push(
            (new Headers(init?.headers).get("authorization") ?? "").replace(
              /^Bearer /,
              "",
            ),
          );
        return globalThis.fetch(input, init);
      },
    });
    try {
      const user = await createOperatorUser("same-token");
      users.push(user);
      const jar: Jar = new Map();
      const signIn = await fetch(`${counting.origin}/login`, {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: counting.origin,
        },
        body: new URLSearchParams({
          email: user.email,
          password: user.password,
        }).toString(),
      });
      expect(signIn.status).toBe(303);
      applyCookies(jar, signIn);
      const me = () =>
        fetch(`${counting.origin}/me`, {
          headers: { cookie: cookieHeader(jar) },
          redirect: "manual",
        });
      const first = sessionFromJar(jar).access_token;
      expect((await me()).status).toBe(200);
      expect((await me()).status).toBe(200);
      expect(bearers).toEqual([first, first]);
      await new Promise((r) => setTimeout(r, 1100));
      markDue(jar);
      const refreshed = await me();
      expect(refreshed.status).toBe(200);
      applyCookies(jar, refreshed);
      const second = sessionFromJar(jar).access_token;
      expect(second).not.toBe(first);
      expect(bearers).toEqual([first, first, second]);
    } finally {
      await counting.close();
    }
  });

  it.each([
    ["HTTP 503", "status"],
    ["network outage", "network"],
    ["timeout", "timeout"],
  ] as const)(
    "denies when getUser fails by %s after successful signature/claims verification (same issuer)",
    async (_label, fault) => {
      const events: AuthTraceEvent[] = [];
      let userCalls = 0;
      const faulty = await startSessionServer({
        apiUrl: env.apiUrl, // unchanged issuer; JWKS and /token pass through
        publishableKey: env.publishableKey,
        storageKey: STORAGE_KEY,
        secure: true,
        absoluteLifetimeSeconds: EIGHT_HOURS,
        // The bound applies to every Auth call (JWKS too), so leave headroom
        // on a loaded host; only the injected /user call ever hangs.
        authTimeoutMs: fault === "timeout" ? 8_000 : 20_000,
        trace: (event) => events.push(event),
        fetch: (input, init) => {
          if (pathOf(input) !== userCallPath)
            return globalThis.fetch(input, init);
          userCalls += 1;
          if (fault === "status")
            return Promise.resolve(
              new Response('{"code":503,"msg":"unavailable"}', {
                status: 503,
                headers: { "content-type": "application/json" },
              }),
            );
          if (fault === "network")
            return Promise.reject(new TypeError("fetch failed"));
          return new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason),
            ),
          );
        },
      });
      try {
        const user = await createOperatorUser(`outage-${fault}`);
        users.push(user);
        const { jar } = await login(user); // via the healthy server
        const sid = claimsOf(sessionFromJar(jar).access_token).session_id;
        const res = await fetch(`${faulty.origin}/me`, {
          headers: { cookie: cookieHeader(jar) },
          redirect: "manual",
        });
        expect(res.status).toBe(401);
        expect(await res.text()).not.toContain("data-subject");
        expect(userCalls).toBeGreaterThanOrEqual(1);
        expect(events).toContainEqual({
          type: "claims-verified",
          subject: user.id,
          sessionId: sid,
        });
        expect(events).toContainEqual({
          type: "denied",
          reason: "auth-validation-failed",
        });
        expect(events.some((e) => e.type === "user-validated")).toBe(false);
        // The same cookies still work against healthy Auth: the denial came
        // only from the failed getUser.
        expect((await fetchAs("/me", jar)).status).toBe(200);
      } finally {
        await faulty.close();
      }
    },
    90_000,
  );
});

describe("external revocation, deletion and anonymous accounts (supported provider APIs)", () => {
  it.each([
    [
      "admin global sign-out (session revocation)",
      (u: TestUser, token: string) => admin.auth.admin.signOut(token, "global"),
    ],
    ["hard deletion", (u: TestUser) => admin.auth.admin.deleteUser(u.id)],
    ["soft deletion", (u: TestUser) => admin.auth.admin.deleteUser(u.id, true)],
  ] as const)(
    "denies the next protected request after %s, with claims still verifying",
    async (label, act) => {
      const user = await createOperatorUser(
        `ext-${label.split(" ")[0] as string}`,
      );
      users.push(user);
      const { jar } = await login(user);
      const token = sessionFromJar(jar).access_token;
      const sid = claimsOf(token).session_id;
      const ok = await (await fetchAs("/me", jar)).text();
      expect(ok).toContain(`data-subject="${user.id}"`);
      expect(ok).toContain(`data-session="${sid}"`);
      const { error } = await act(user, token);
      expect(error).toBeNull();
      const trace = traceFrom();
      expect((await fetchAs("/me", jar)).status).toBe(401);
      expect(trace()).toEqual([
        { type: "claims-verified", subject: user.id, sessionId: sid },
        { type: "denied", reason: "auth-validation-failed" },
      ]);
      markDue(jar); // and the refresh token is dead too
      expect((await fetchAs("/me", jar)).status).toBe(401);
    },
  );

  it("denies anonymous accounts: provider refuses anonymous sign-in, and a GoTrue-signed is_anonymous token is rejected", async () => {
    expect((await plainClient().auth.signInAnonymously()).error?.code).toBe(
      "anonymous_provider_disabled",
    );
    const user = await createOperatorUser("anonymous");
    users.push(user);
    const { jar } = await login(user);
    // Test-only provider-state forcing BEFORE GoTrue mints the next token.
    await db.query("update auth.users set is_anonymous = true where id = $1", [
      user.id,
    ]);
    const direct = await plainClient().auth.refreshSession({
      refresh_token: sessionFromJar(jar).refresh_token,
    });
    expect(direct.error).toBeNull();
    const token = direct.data.session?.access_token as string;
    expect(claimsOf(token).is_anonymous).toBe(true);
    expect((await plainClient().auth.getClaims(token)).error).toBeNull(); // genuinely signed
    writeSessionToJar(jar, direct.data.session as Session);
    const trace = traceFrom();
    expect((await fetchAs("/me", jar)).status).toBe(401);
    expect(trace()).toEqual([
      { type: "denied", reason: "anonymous-or-unknown" },
    ]);
  });
});

describe("chunked session cookies", () => {
  it.each([
    ["grow", false],
    ["grow", true],
    ["shrink", false],
    ["shrink", true],
  ] as const)(
    "clears incoming and refreshed cookies when chunks %s during logout (remote rejected: %s)",
    async (shape, rejected) => {
      const user = await createOperatorUser(
        `logout-${shape}-${rejected}`,
        shape === "shrink" ? { padding: "x".repeat(3000) } : {},
      );
      users.push(user);
      const { jar } = await login(user);
      const sid = claimsOf(sessionFromJar(jar).access_token).session_id;
      const updated = await admin.auth.admin.updateUserById(user.id, {
        user_metadata: { padding: shape === "grow" ? "x".repeat(3000) : null },
      });
      expect(updated.error).toBeNull();
      markDue(jar);
      const incoming = new Set(jar.keys());
      expect(incoming.has(STORAGE_KEY)).toBe(shape === "grow");
      let refreshedToken: string | undefined;
      const originalFetch = globalThis.fetch;
      const remote = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (input, init) => {
          if (rejected && String(input) === `${ISSUER}/logout?scope=local`)
            return new Response("{}", { status: 503 });
          const response = await originalFetch(input, init);
          if (
            String(input) === `${ISSUER}/token?grant_type=refresh_token` &&
            response.ok
          )
            refreshedToken = (await response.clone().json()).access_token;
          return response;
        });
      let out: Response;
      try {
        out = await postForm("/logout", jar, {});
      } finally {
        remote.mockRestore();
      }
      expect(refreshedToken).toBeTypeOf("string");
      expect(out.status).toBe(rejected ? 502 : 303);
      if (rejected)
        expect(await out.text()).toContain("revocation was not confirmed");
      const deleted = sessionCookies(out);
      const names = new Set(deleted.map((cookie) => cookie.name));
      // The refresh changed the shape: a newly buffered name must also be deleted.
      expect([...names].some((name) => !incoming.has(name))).toBe(true);
      for (const name of incoming) expect(names.has(name)).toBe(true);
      for (const cookie of deleted) {
        expectHardenedFlags(cookie);
        expect(cookie.value === "", `${cookie.name}: cleared value`).toBe(true);
        expect(cookie.attributes.get("max-age")).toBe("0");
      }
      applyCookies(jar, out);
      expect(jar.size).toBe(0);
      expect((await fetchAs("/me", jar)).status).toBe(401);
      if (rejected) {
        // The provider session survives, but the browser must still be signed out.
        expect(await sessionRow(sid)).toBeDefined();
        expect(
          (await plainClient().auth.getUser(refreshedToken)).error,
        ).toBeNull();
      } else {
        expect(await sessionRow(sid)).toBeUndefined();
        expect(
          (await plainClient().auth.getUser(refreshedToken)).error,
        ).not.toBeNull();
      }
    },
  );

  it("flags every chunk, deletes stale chunks when the session shrinks, and deletes all chunks at logout", async () => {
    // Large enough to chunk; GoTrue's Kong gateway rejects bearer tokens over ~8 KB (observed 400),
    // so oversized JWT claims would break logout/getUser: keep user metadata small.
    const big = await createOperatorUser("big", { padding: "x".repeat(3000) });
    const small = await createOperatorUser("small");
    users.push(big, small);
    const { jar, res } = await login(big);
    const chunks = sessionCookies(res);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.every((c) => /\.\d+$/.test(c.name))).toBe(true);
    chunks.forEach(expectHardenedFlags);

    const shrink = await postForm("/login", jar, {
      email: small.email,
      password: small.password,
    });
    expect(shrink.status).toBe(303);
    const written = sessionCookies(shrink);
    written.forEach(expectHardenedFlags);
    applyCookies(jar, shrink);
    const remaining = [...jar.keys()].filter((n) => n.startsWith(STORAGE_KEY));
    expect(remaining.length).toBeLessThan(chunks.length);
    expect(claimsOf(sessionFromJar(jar).access_token).sub).toBe(small.id);
    const me = await (await fetchAs("/me", jar)).text();
    expect(me).toContain(`data-subject="${small.id}"`);

    const again = await login(big);
    const out = await postForm("/logout", again.jar, {});
    expect(out.status).toBe(303);
    const deleted = sessionCookies(out);
    expect(deleted.map((c) => c.name).sort()).toEqual(
      [...again.jar.keys()].filter((n) => n.startsWith(STORAGE_KEY)).sort(),
    );
    for (const cookie of deleted) {
      expectHardenedFlags(cookie);
      expect(cookie.attributes.get("max-age")).toBe("0");
    }
  });
});

describe("Auth unavailable", () => {
  it("denies access and login, and logout clears cookies while reporting unconfirmed revocation", async () => {
    const user = await createOperatorUser("unavailable");
    users.push(user);
    const { jar } = await login(user);
    const down = await startSessionServer({
      apiUrl: "http://127.0.0.1:9", // discard port: nothing listens
      publishableKey: env.publishableKey,
      storageKey: STORAGE_KEY,
      secure: true,
      absoluteLifetimeSeconds: EIGHT_HOURS,
    });
    try {
      const me = await fetch(`${down.origin}/me`, {
        headers: { cookie: cookieHeader(jar) },
        redirect: "manual",
      });
      expect([401, 503]).toContain(me.status);
      expect(await me.text()).not.toContain("data-subject");
      const loginRes = await fetch(`${down.origin}/login`, {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: down.origin,
        },
        body: new URLSearchParams({
          email: user.email,
          password: user.password,
        }).toString(),
      });
      expect(loginRes.status).toBe(503);
      const out = await fetch(`${down.origin}/logout`, {
        method: "POST",
        redirect: "manual",
        headers: {
          cookie: cookieHeader(jar),
          "content-type": "application/x-www-form-urlencoded",
          origin: down.origin,
        },
        body: "",
      });
      expect(out.status).toBe(502);
      expect(await out.text()).toContain("not confirmed");
      const deleted = sessionCookies(out);
      expect(deleted.map((c) => c.name).sort()).toEqual(
        [...jar.keys()].filter((n) => n.startsWith(STORAGE_KEY)).sort(),
      );
      deleted.forEach((c) => expect(c.attributes.get("max-age")).toBe("0"));
    } finally {
      await down.close();
    }
  });
});

describe("real browser (Chromium) sees only HttpOnly cookies", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("logs in through an HTML form, exposes no cookie or token to page script, and logs out", async () => {
    const user = await createOperatorUser("browser");
    users.push(user);
    const origin = server.origins[1] as string; // http://localhost:<port>
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${origin}/login`);
    await page.fill('input[name="email"]', user.email);
    await page.fill('input[name="password"]', user.password);
    await Promise.all([
      page.waitForURL(`${origin}/me`),
      page.click('button[type="submit"]'),
    ]);
    await expect(
      page.locator("#principal").getAttribute("data-subject"),
    ).resolves.toBe(user.id);

    const cookies = (await context.cookies()).filter((c) =>
      c.name.startsWith(STORAGE_KEY),
    );
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.secure).toBe(true);
      expect(cookie.sameSite).toBe("Lax");
      expect(cookie.path).toBe("/");
      expect(cookie.domain).toBe("localhost"); // host-only
      expect(cookie.expires - Date.now() / 1000).toBeLessThanOrEqual(
        EIGHT_HOURS,
      );
    }
    expect(await page.evaluate(() => document.cookie)).toBe("");
    const jar: Jar = new Map(
      cookies.map((c) => [c.name, decodeURIComponent(c.value)]),
    );
    const session = sessionFromJar(jar);
    const html = await page.content();
    expect(html).not.toContain(session.access_token);
    expect(html).not.toContain(session.refresh_token);
    expect(
      await page.evaluate(
        () =>
          JSON.stringify({ ...localStorage }) +
          JSON.stringify({ ...sessionStorage }),
      ),
    ).toBe("{}{}");

    await Promise.all([
      page.waitForURL(`${origin}/login`),
      page.click('button[type="submit"]'),
    ]);
    expect(
      (await context.cookies()).filter((c) => c.name.startsWith(STORAGE_KEY)),
    ).toEqual([]);
    const after = await page.goto(`${origin}/me`);
    expect(after?.status()).toBe(401);
    await context.close();
  }, 90_000);
});

function randomUuid() {
  const b = randomBytes(16);
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
