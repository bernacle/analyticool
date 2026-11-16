import {
  parseCookieHeader,
  serializeCookieHeader,
  stringFromBase64URL,
  type CookieMethodsServer,
  type CookieOptions,
} from "@supabase/ssr";

/**
 * BRU-492 preparation: the server-only getAll/setAll cookie adapter from ADR
 * §2, as a verification artifact (not application code). It never trusts the
 * SDK's cookie options: every write and every deletion, for every chunk, is
 * re-issued HttpOnly, SameSite=Lax, Path=/, host-only (no Domain), Secure
 * unless the caller explicitly opts into loopback development, and with a
 * Max-Age capped to what remains of the absolute login lifetime. The SDK
 * default would be httpOnly:false and a 400-day Max-Age.
 *
 * Writes are buffered and emitted once by `flush()`, so the cap is computed
 * from the complete session being written and a late SDK write (after the
 * response was committed) is a detected violation instead of a lost cookie.
 */
export type CookiePolicy = Readonly<{
  /** Session cookie base name; chunks are `${storageKey}.0`, `.1`, … */
  storageKey: string;
  /** false only for explicit loopback development. */
  secure: boolean;
  /** ADR §2: 8 hours. */
  absoluteLifetimeSeconds: number;
  now?: () => number;
}>;

export type CookieWrite = Readonly<{
  name: string;
  value: string;
  options: CookieOptions;
}>;

export type FlushResult = Readonly<{
  setCookie: readonly string[];
  headers: Readonly<Record<string, string>>;
}>;

const isSessionCookie = (storageKey: string, name: string) =>
  name === storageKey ||
  (name.startsWith(`${storageKey}.`) &&
    /^\d+$/.test(name.slice(storageKey.length + 1)));

/** Reassemble the session value the SDK is writing (chunked or not). */
function sessionValueFrom(
  storageKey: string,
  writes: ReadonlyMap<string, CookieWrite>,
): string | null {
  const whole = writes.get(storageKey);
  if (whole && whole.value) return whole.value;
  let value = "";
  for (let i = 0; ; i += 1) {
    const chunk = writes.get(`${storageKey}.${i}`);
    if (!chunk || !chunk.value) break;
    value += chunk.value;
  }
  return value || null;
}

/**
 * Absolute deadline (epoch seconds) of the login a session cookie belongs to,
 * from the `amr` authentication timestamp of its access token. This only ever
 * shortens cookie lifetime, so it reads the token without verifying it;
 * authority always comes from getClaims/getUser and the database. Returns
 * null when the value cannot be interpreted (callers then refuse to persist).
 */
export function loginDeadlineFromSessionValue(
  value: string,
  absoluteLifetimeSeconds: number,
): number | null {
  try {
    const json = value.startsWith("base64-")
      ? stringFromBase64URL(value.slice("base64-".length))
      : value;
    const session = JSON.parse(json) as { access_token?: unknown };
    if (typeof session.access_token !== "string") return null;
    const payload = session.access_token.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(stringFromBase64URL(payload)) as {
      amr?: { timestamp?: unknown }[];
    };
    const stamps = (claims.amr ?? [])
      .map((entry) => entry.timestamp)
      .filter((t): t is number => typeof t === "number" && t > 0);
    if (stamps.length === 0) return null;
    return Math.min(...stamps) + absoluteLifetimeSeconds;
  } catch {
    return null;
  }
}

export function createCookieJar(
  requestCookieHeader: string | undefined,
  policy: CookiePolicy,
) {
  const now = policy.now ?? (() => Date.now());
  const request = parseCookieHeader(requestCookieHeader ?? "").map((c) => ({
    name: c.name,
    value: c.value ?? "",
  }));
  const writes = new Map<string, CookieWrite>();
  const sdkHeaders: Record<string, string> = {};
  const violations: string[] = [];
  let sealed = false;

  const methods: CookieMethodsServer = {
    encode: "tokens-only",
    getAll: () => request,
    setAll: (cookies, headers) => {
      if (sealed) {
        violations.push(
          `setAll after response commit: ${cookies.map((c) => c.name).join(",")}`,
        );
        throw new Error("Cookie write after the response was committed.");
      }
      for (const cookie of cookies) writes.set(cookie.name, cookie);
      Object.assign(sdkHeaders, headers ?? {});
    },
  };

  /** Explicitly delete every session chunk the browser sent (logout fallback). */
  function deleteAllSessionCookies() {
    for (const { name } of request)
      if (
        isSessionCookie(policy.storageKey, name) ||
        name.startsWith(`${policy.storageKey}-`)
      )
        writes.set(name, { name, value: "", options: { maxAge: 0 } });
  }

  function flush(): FlushResult {
    sealed = true;
    const nowSeconds = Math.floor(now() / 1000);
    const sessionValue = sessionValueFrom(policy.storageKey, writes);
    const deadline = sessionValue
      ? loginDeadlineFromSessionValue(
          sessionValue,
          policy.absoluteLifetimeSeconds,
        )
      : null;
    // A session we cannot bound (or that is past its deadline) is not stored.
    const remaining =
      deadline === null
        ? sessionValue
          ? 0
          : null
        : Math.max(0, deadline - nowSeconds);
    const setCookie: string[] = [];
    for (const write of writes.values()) {
      const isDeletion = write.value === "" || write.options.maxAge === 0;
      const cap = remaining ?? policy.absoluteLifetimeSeconds;
      const maxAge = isDeletion
        ? 0
        : Math.min(write.options.maxAge ?? policy.absoluteLifetimeSeconds, cap);
      const options: CookieOptions = {
        httpOnly: true,
        secure: policy.secure,
        sameSite: "lax",
        path: "/",
        maxAge,
      };
      setCookie.push(
        serializeCookieHeader(
          write.name,
          maxAge === 0 ? "" : write.value,
          options,
        ),
      );
    }
    return {
      setCookie,
      headers: { ...sdkHeaders, "Cache-Control": "private, no-store" },
    };
  }

  return {
    methods,
    deleteAllSessionCookies,
    flush,
    violations: () => [...violations],
    hasSessionCookie: () =>
      request.some(
        (c) => isSessionCookie(policy.storageKey, c.name) && c.value !== "",
      ),
  };
}
