/**
 * BRU-492 preparation (accepted ADR §2 amendment, 2026-11-16): the eight-hour
 * absolute login limit, derived ONLY from GoTrue-signed password-login `amr`
 * timestamps, which GoTrue preserves across refresh. Never from account
 * last_sign_in_at, token iat, cookie age or session-row created_at.
 *
 * Fail-closed rules:
 * - `amr` must be a non-empty array; every entry must be an object whose
 *   `method` is the supported `"password"` and whose `timestamp` is a finite
 *   positive integer (epoch seconds). Anything else denies the whole token.
 * - The earliest password timestamp is the login time.
 * - A timestamp more than FUTURE_CLOCK_TOLERANCE_SECONDS ahead of the server
 *   clock denies. That tolerance only validates the timestamp; it never
 *   extends the deadline, which is always `loginAt + lifetime`.
 */
export const FUTURE_CLOCK_TOLERANCE_SECONDS = 60;
export const SUPPORTED_LOGIN_METHOD = "password";

export type LoginAgeDenial =
  | "missing-amr"
  | "malformed-amr"
  | "unsupported-method"
  | "invalid-clock"
  | "future-timestamp"
  | "expired";

export type LoginAge =
  | Readonly<{ ok: true; loginAt: number; deadline: number }>
  | Readonly<{ ok: false; reason: LoginAgeDenial }>;

const isEpochSeconds = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/**
 * Structural check only (no clock): the deadline of a token's password login,
 * or a denial. Used unverified by the cookie adapter, which may only SHORTEN
 * cookie lifetime; authority always comes from `evaluateLoginAge` on claims
 * that getClaims has verified.
 */
export function passwordLoginDeadline(
  claims: Readonly<Record<string, unknown>>,
  absoluteLifetimeSeconds: number,
): LoginAge {
  const amr = claims.amr;
  if (!Array.isArray(amr) || amr.length === 0)
    return { ok: false, reason: "missing-amr" };
  const stamps: number[] = [];
  for (const entry of amr as unknown[]) {
    if (typeof entry !== "object" || entry === null)
      return { ok: false, reason: "malformed-amr" };
    const { method, timestamp } = entry as {
      method?: unknown;
      timestamp?: unknown;
    };
    if (typeof method !== "string" || !isEpochSeconds(timestamp))
      return { ok: false, reason: "malformed-amr" };
    if (method !== SUPPORTED_LOGIN_METHOD)
      return { ok: false, reason: "unsupported-method" };
    stamps.push(timestamp);
  }
  const loginAt = Math.min(...stamps);
  return { ok: true, loginAt, deadline: loginAt + absoluteLifetimeSeconds };
}

export function evaluateLoginAge(
  claims: Readonly<Record<string, unknown>>,
  nowSeconds: number,
  absoluteLifetimeSeconds: number,
): LoginAge {
  if (!isEpochSeconds(nowSeconds))
    return { ok: false, reason: "invalid-clock" };
  const login = passwordLoginDeadline(claims, absoluteLifetimeSeconds);
  if (!login.ok) return login;
  const amr = claims.amr as readonly { timestamp: number }[];
  if (
    amr.some((e) => e.timestamp > nowSeconds + FUTURE_CLOCK_TOLERANCE_SECONDS)
  )
    return { ok: false, reason: "future-timestamp" };
  if (nowSeconds >= login.deadline) return { ok: false, reason: "expired" };
  return login;
}
