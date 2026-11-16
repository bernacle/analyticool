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
  exceedsAbsoluteLifetime,
  startSessionServer,
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
  }, 30_000);

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
      expect(cookie.value).toBe("");
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
      exceedsAbsoluteLifetime(claims, loginAt + EIGHT_HOURS - 60, EIGHT_HOURS),
    ).toBe(false);
    expect(
      exceedsAbsoluteLifetime(claims, loginAt + EIGHT_HOURS, EIGHT_HOURS),
    ).toBe(true);
    expect(
      exceedsAbsoluteLifetime({ ...claims, amr: [] }, loginAt, EIGHT_HOURS),
    ).toBe(true);
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
    // Evidence for the ADR's database-time session-age check (design gate, see report):
    // without it, a token issued just before the 8-hour limit is usable for up to 15 minutes.
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
});

describe("chunked session cookies", () => {
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
  }, 60_000);
});

function randomUuid() {
  const b = randomBytes(16);
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
