# BRU-492 preparation report

Status: **Preparation complete; final review pending.** Date 2026-11-16. Baseline `main` = `01c2f46`. Implements only the authorized preparation in [the approved ADR](persistent-metrics-library.md) §7, plus validation of the owner-accepted [Auth-boundary amendment](bru-492-auth-boundary-amendment.md). No application route, production metric schema, lifecycle, migration, service, feature or deployment is added. The demo behaves exactly as before.

| ADR §7 preparation item                      | Result                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1. Dependency pins, lockfile, evidence regen | Done (§1); no dependency change since                                                                                |
| 2. Disposable local Supabase Auth + Postgres | Done (§2)                                                                                                            |
| 3. Server-only HttpOnly cookie integration   | **Passed**: 39/39 against real GoTrue (§3, §4b)                                                                      |
| 4. Runtime role / FORCE RLS / definer probe  | **Passed** under the accepted amendment: 26/26 as the actual runtime login (§4b). Original predicate rejected (§4a). |
| 5. Separate fail-closed CI workflow          | Done; floors raised to 39 + 26 + 6 = 71, with 14 gate-negative checks (§5)                                           |
| 6. Operator check/setup patch                | Prepared, **not applied** (§6). Separate sandbox fix awaits manual merge and installed-runtime verification (§6).    |
| 7. Baseline verification                     | All green at the final head (§7)                                                                                     |

## 1. Dependencies (exact pins)

Registry inspected 2026-11-16. Latest stable versions were chosen and are compatible with Node 24.21.0, Next.js 16.4.5 and pnpm 10.34.9.

| Package                 | Pin       | Where                                                                          |
| ----------------------- | --------- | ------------------------------------------------------------------------------ |
| `@supabase/supabase-js` | `2.119.0` | `apps/demo` dependencies (PR 1 placement); root devDependencies (verification) |
| `@supabase/ssr`         | `0.12.7`  | same (peer `@supabase/supabase-js ^2.114.0`)                                   |
| `pg`                    | `8.23.1`  | same                                                                           |
| `@types/pg`             | `8.23.1`  | `apps/demo` and root devDependencies                                           |

Root declarations exist only because pnpm's strict layout cannot resolve `apps/demo` dependencies from `verification/`. The pins are identical, so there is one lockfile entry per package. The lockfile also adds transitive packages: `@supabase/{auth,functions,postgrest,realtime,storage}-js@2.119.0`, `@supabase/phoenix`, `cookie@1.1.1`, `iceberg-js`, `tslib` and the `pg-*` / `postgres-*` helpers. No ORM, framework, session registry, browser SDK usage or other library was added. `server-only` was not needed.

The lockfile change invalidated net-receipts provenance, as the ADR predicted. `pnpm verify:net-receipts --write` (Node 24.21.0) changed only three provenance digests in `verification/net-receipts/report.json`: `package.json`, `pnpm-lock.yaml` and the aggregate implementation digest. Replay: 75 cases, 7/7 incorrect variants detected, report `sha256:be52ef10…4971`. The Python oracle exits 0. No expected calculation value changed.

## 2. Disposable local stack

| Component        | Pin                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Supabase CLI     | `3.1.0` (stable, 2026-11-09). darwin_arm64 sha256 `2bd2a45f…7a26`; linux_amd64 sha256 `dbe9fd66…ac4d` (in CI) |
| PostgreSQL 17.11 | `public.ecr.aws/supabase/postgres:17.11.0.018@sha256:7c31363a…cf8c`                                           |
| Auth (GoTrue)    | `public.ecr.aws/supabase/gotrue:v2.197.0@sha256:1736a630…2c6b`                                                |
| Gateway          | `public.ecr.aws/supabase/kong:2.8.1@sha256:1b53405d…f09f6d`                                                   |

Full digests are in [`images.lock`](../../verification/auth-metadata/images.lock). The CLI is installed outside the repository, at `~/.local/share/analyticool-tools/supabase-cli-3.1.0/bin/supabase`, from the GitHub release with its checksum verified. Only db, auth and kong run. All other services are disabled in [`config.toml`](../../verification/auth-metadata/supabase/config.toml) and excluded at start.

GoTrue's effective configuration was confirmed: `GOTRUE_JWT_EXP=900` (15 min), `GOTRUE_SESSIONS_TIMEBOX=8h0m0s`, `GOTRUE_DISABLE_SIGNUP=true`, refresh rotation on with the default 10 s reuse interval, and ES256 signing keys (JWKS). No accelerated configuration is used anywhere. Expiry is forced per test instead (§3).

[`stack.sh`](../../verification/auth-metadata/stack.sh) is the **operator, unsandboxed** lifecycle:

- `prefetch` pulls by digest and verifies.
- `start` creates the network, starts the stack, then verifies image digests, loopback-only bindings and exactly 3 containers. It writes `~/.local/state/analyticool-bru492/stack.env` (mode 0600, loopback URLs and keys).
- `verify` re-checks a running stack.
- `stop` removes the containers, volumes, network and state.

A cold `start` takes about 22 s.

**Finding:** the CLI publishes ports without a host IP, so it listened on `0.0.0.0`/`[::]`, which is LAN-reachable with the well-known `postgres` password. `stack.sh` therefore runs the stack on a dedicated network created with `com.docker.network.bridge.host_binding_ipv4=127.0.0.1` and fails if any binding is not `127.0.0.1`. The network uses an explicit subnet because Docker's default pools on this host are exhausted by other projects. Those projects' networks were left alone.

The keys are the Supabase CLI's fixed, publicly documented local defaults ("shared defaults, do not use in production"). They are read at runtime from `supabase status` and are not committed. No production or hosted credential was requested or used. Users are created per run through the Auth admin API: synthetic `@synthetic.invalid` emails, random passwords that are never printed, deleted afterwards.

## 3. Server-only HttpOnly session: passed (original contract)

Artifacts in `verification/auth-metadata/`:

- [`cookie-policy.ts`](../../verification/auth-metadata/cookie-policy.ts), the ADR §2 `getAll`/`setAll` adapter.
- [`session-server.ts`](../../verification/auth-metadata/session-server.ts), a plain `node:http` login/me/logout flow. It is not a Next.js route and no browser SDK is involved.
- [`auth-session.test.ts`](../../verification/auth-metadata/auth-session.test.ts).

The adapter buffers SDK writes and re-issues **every write and deletion of every chunk** as `HttpOnly; Secure; SameSite=Lax; Path=/`, with no Domain and no Expires. Max-Age is capped at the remaining 8 h from the signed `amr` login time. A session it cannot bound is written as a deletion. A write after the response is committed is a detected violation. `encode: "tokens-only"` keeps the user object out of cookies. The SDK's own defaults would be `httpOnly: false` with a 400-day Max-Age. `authenticateRequest()` now implements the accepted amendment; see §4b.

**Original head `2aedaee`: 22/22 passed; review fixes raise this to 26/26.** These cases cover:

- disabled signup
- 900 s ES256 tokens with iss/aud/sub/session_id that match the `auth.sessions` row
- wrong password
- cross-origin and Origin-less login and logout refused
- hardened flags on every cookie, an allowlisted redirect, no token in any body
- tampered cookie, attacker-key forgery with the same `kid`, and `alg=none`
- real token rejected once the verifier clock passes 15 min
- request-layer refresh (same session, rotated tokens, `amr` and `created_at` unchanged, Max-Age decreasing)
- two simultaneous refreshes of one stale session both succeed
- superseded refresh-token replay rejected
- Max-Age cap and fail-closed unit cases
- late-write detection
- the 8 h limit despite refresh
- timebox refresh denial with chunk deletion
- banned account denied
- acknowledged logout revokes the `auth.sessions` row, deletes every chunk, and defeats replay of both tokens; rejected logout clears cookies but reports remote revocation unconfirmed (see review correction below)
- chunked sessions: all chunks flagged, stale chunks deleted on shrink, all deleted at logout
- Auth unavailable: denied, never a fallback; logout clears cookies and reports that revocation was not confirmed
- **real Chromium**: form login, all cookies HttpOnly/Secure/Lax/host-only, `document.cookie === ""`, no token in HTML or storage, logout clears everything

Mutation check: setting `httpOnly: false` fails 14 tests, and removing the lifetime cap fails 11.

How expiry is tested without accelerated configuration:

- 15 min access expiry: the real signed token is verified with only the **verifier's** `Date` advanced. It passes at +14 min and fails at +15 min.
- Refresh: the test edits the browser-held, untrusted `expires_at` so the SDK refreshes against real GoTrue now.
- 8 h timebox: `auth.sessions.created_at` is backdated in the disposable database, as a test-only admin action.

Server-side expiry of a genuinely expired token at GoTrue is not exercised, because that would need a 15-minute wait. Signature, exp and session checks are covered.

Observed GoTrue v2.197.0 behaviour that PR 1 must design around:

- **Reuse detection does not revoke the session.** Replaying a superseded refresh token after 10 s returns `refresh_token_already_used`, but the legitimate chain keeps working. Replaying the parent while its child is still unused returns that child, which is GoTrue's lost-response allowance.
- **`/user` does not independently enforce database session age.** Backdating database `created_at` makes refresh fail (`session_expired`) while `/user` accepts the still-valid token. Its signed AMR remains fresh, so this artificial divergence does not prove an eight-hour-old login bypasses the application limit. The real signed near-boundary protected-request tests are in §4b.
- **`Referrer-Policy: no-referrer` breaks Origin checks.** With it, Chromium sends `Origin: null` on same-origin form POSTs, so the login was refused. Use `same-origin` or `strict-origin-when-cross-origin`. This applies equally to Next.js Server Action Origin checks.
- **Oversized JWT claims break the gateway.** An 8.8 KB access token from large `user_metadata` makes Kong return 400 on `/logout` and `/user`. Keep user metadata small.

## 4. Amended Auth boundary and metadata pattern: validated

### 4a. Old design: Auth-session predicate (blocked, rejected)

Original ADR §2/§3 asked for a narrowly granted, read-only predicate that checks the verified subject and `session_id` against an active `auth.sessions` row. Its SECURITY DEFINER owner was to be **NOLOGIN/NOBYPASSRLS**, with no change to the managed Auth schema. Against the real Supabase Postgres image, using the hosted-realistic migration credential `postgres` (non-superuser, BYPASSRLS, CREATEROLE), this cannot be built. [`auth-predicate-gate.test.ts`](../../verification/auth-metadata/auth-predicate-gate.test.ts) records why (6/6, every probe rolled back):

| Probe                                                                                         | Observed                                                                                                                                                    |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform facts                                                                                | `auth.sessions`/`auth.users`: RLS enabled (not forced), **0 policies**. `postgres` has `SELECT WITH GRANT OPTION` but **no grant option on schema `auth`**. |
| **A**: dedicated NOLOGIN/NOBYPASSRLS owner, column grants                                     | `GRANT USAGE ON SCHEMA auth` grants nothing; reading fails with `42501`.                                                                                    |
| **A2**: same, with schema usage inherited from `anon`                                         | Runs, but sees **0 rows** because RLS has no policy. Adding a policy would alter the managed Auth schema.                                                   |
| **C**: dedicated NOLOGIN **BYPASSRLS** owner, `anon` membership for usage, column-only SELECT | Reads the row. Other columns and UPDATE give `42501`. Inherits `anon`'s other privileges; BYPASSRLS defeats RLS wherever they reach.                        |
| **B**: fixed-body definer owned by `postgres` (Supabase's documented pattern)                 | Reads the row. The owner is broadly privileged.                                                                                                             |

The owner accepted the amendment on 2026-11-16, so this design is **rejected**, not deferred. Candidates B and C are **historical diagnostics only**, never an active application owner. The six probes stay in CI with their floor of 6 as tripwires for changes to Supabase's managed grants. No probe was retired.

### 4b. New contract: fresh Auth validation + metadata RLS (validated)

Normative text: [ADR](persistent-metrics-library.md) §2, §3, §5, §6.

**Auth** ([`session-server.ts`](../../verification/auth-metadata/session-server.ts) `authenticateRequest`, [`login-age.ts`](../../verification/auth-metadata/login-age.ts)): for each protected operation and retry, take the effective token after any SDK refresh. `getClaims(token)` checks the signature and exp, then issuer, audience, role, UUID sub/session_id and `is_anonymous === false`. Next comes the signed password-login AMR age check. Last, a fresh `getUser(token)` of that same token must return the same subject as a non-anonymous email account. Every SDK Auth call is time-bounded (default 5 s). Logout keeps the raw GoTrue 204-only confirmation and clears all chunks for every outcome.

`auth-session.test.ts`, **39/39** against real GoTrue v2.197.0 (13 new):

- **Near/at eight hours with real signatures.** As a test-only admin action, the disposable `auth.mfa_amr_claims` row is backdated **before** GoTrue mints the next token. The server's request-layer refresh then obtains a genuinely GoTrue-signed token. No claim is test-made, and session `created_at` is untouched.
  - At 8 h − 120 s: allowed, with cookie Max-Age ≤ 120 s, and the signed login time is unchanged after a second refresh.
  - At 8 h: denied (`login-age:expired`). GoTrue still issues a fresh token (new `iat`, same AMR), which is denied too, and a request-layer refresh writes only cookie deletions.
  - Backdating `last_sign_in_at` has no effect.
- **Future clock.** A GoTrue-signed login 300 s in the future is denied; one 20 s ahead is accepted.
- **Malformed and unsupported AMR (unit cases).** Strings, fractions, NaN, ±∞, 0, negatives, unsafe integers, missing method and non-password methods are all rejected. The earliest timestamp wins. Within the 60 s tolerance the deadline is still exactly `ts + 8 h`.
- **Same token, no cache.** Each `/me` makes exactly one `/user` call, whose bearer equals the verified token, including the rotated token after refresh.
- **`getUser` failure after successful claim verification** (same issuer, real signature; only `/user` fails): HTTP 503, network error and timeout each deny. The trace shows `claims-verified` followed by `auth-validation-failed`. The same cookies work against healthy Auth.
- **Supported provider APIs.** Admin global sign-out, hard deletion and soft deletion (`deleteUser(id, true)`) each deny the next request after claims still verify, and the refresh path dies too. The existing ban tests remain.
- **Anonymous denial.** The provider refuses anonymous sign-in. A genuinely GoTrue-signed token with `is_anonymous: true` is denied at the claims stage. To get it, the disposable `auth.users` flag is flipped before minting.

**Metadata pattern** ([`metadata-probe.sql`](../../verification/auth-metadata/metadata-probe.sql), [`metadata-rls.test.ts`](../../verification/auth-metadata/metadata-rls.test.ts), [`protected-operation.ts`](../../verification/auth-metadata/protected-operation.ts)), **26/26**. Generic `probe_items`/`probe_item_notes` only; the schema and roles are created per run and dropped afterwards. The test connects as an **actual LOGIN runtime**:

- **Roles:** runtime is LOGIN, NOBYPASSRLS, NOINHERIT, member of no role and owns nothing. Owner is NOLOGIN, NOBYPASSRLS and owns every object. All four tables have FORCE RLS.
- **Commands:** SECURITY DEFINER with `search_path=pg_catalog, pg_temp` and schema-qualified references. They take no workspace, actor or role arguments. Context helpers are invokers that read only GUCs. PUBLIC, `anon`, `authenticated` and `service_role` have no EXECUTE and no schema usage.
- **Policies:** the membership policy covers only the caller's own row, from verified context. Item policies look up that member row, so no policy recurses.
- **Escalation denied (`42501`) or without effect:** SET ROLE/SESSION AUTHORIZATION to the owner, `postgres` or Data API roles; creating tables, views, functions or schemas; altering RLS, policies or ownership; GRANT attempts (ACLs proven unchanged); direct DML/TRUNCATE; FOR SHARE/KEY SHARE on memberships; Auth tables.
- **Hijack attempts:** a temp-table shadow plus a caller `search_path` still meets the command's own denial. The owner obeys FORCE RLS: it sees nothing without context and cannot write for another actor.
- **Context:** no, empty, malformed, injection-shaped or unknown context, or a missing user or session, denies reads and commands. A and B are isolated in both directions (list, search, count, lookup, own memberships, untrusted workspace selector).
- **References and roles:** the composite FK rejects cross-workspace references, and foreign and missing items fail identically. Role matrix: viewer, editor and admin, with attribution only from context.
- **Membership changes:** demotion and revocation apply to the very next command. An operator UPDATE/DELETE waits on an in-flight command's FOR SHARE lock; a command started during an uncommitted demotion waits, then is denied. A contrast test shows FOR KEY SHARE would **not** block the demotion.
- **Pooling:** one pooled connection carries A, no context, B (failed), then no context, with no leakage.
- **Trust boundary (documented, not overclaimed):** the runtime credential can itself assert any member's context. The GUC context does not prevent impersonation via arbitrary SQL under that credential.
- **Real GoTrue plus metadata ordering:**
  - Auth runs before the transaction, never while a transaction is open, and attribution is the verified subject/session.
  - An injected `40001` retries with a second fresh `getUser` and commits once.
  - Revocation between attempts denies the retry and nothing commits.
  - The accepted in-flight race is demonstrated: a revocation during an authorized attempt still commits, and the next operation is denied.
  - A demotion between attempts is enforced by the database on retry.

Mutation checks:

| Mutation                                              | Failing tests |
| ----------------------------------------------------- | ------------- |
| Skip `getUser`                                        | 14            |
| Drop the future-clock check                           | 3             |
| `FOR KEY SHARE` instead of `FOR SHARE`                | 3             |
| Remove FORCE RLS on `probe_items`                     | 2             |
| Keep PUBLIC EXECUTE                                   | 1             |
| Hijackable `search_path` with unqualified memberships | 2             |
| Unrestricted membership policy                        | 1             |

Each mutation was reverted.

**Accepted limits:**

- Auth validation and commit are separate, so a revocation can race bounded in-flight work.
- The metadata database no longer independently checks managed session rows.
- AMR is a pinned GoTrue v2.197.0 contract that needs upgrade regression tests; host clocks must be correct.
- The SDK's JWKS signing-key cache is not an authentication cache.
- No Next.js wiring exists yet (PR 1). Real expiry of a 15-minute token at GoTrue is still not waited out.

## 5. CI and fail-closed gates

[`.github/workflows/auth-metadata.yml`](../../.github/workflows/auth-metadata.yml) is a new workflow; `ci.yml` and `postgres-isolation.yml` are untouched. It:

1. installs the checksum-pinned CLI;
2. runs `stack.sh prefetch/start` with digest and loopback verification;
3. installs Chromium;
4. runs the suite with a JSON report;
5. runs [`assert-auth-metadata-report.mjs`](../../scripts/assert-auth-metadata-report.mjs), which fails if a file is missing, any case is skipped, todo or failed, or a count is below the floor (`auth-session` ≥ 39, `metadata-rls` ≥ 26, historical `auth-predicate-gate` ≥ 6, total ≥ 71);
6. runs [`check-auth-metadata-gate.mjs`](../../scripts/check-auth-metadata-gate.mjs), the gate-negative proof;
7. retains the JSON report as a 14-day CI artifact, including on failure (added after review).

The gate-negative script must accept the real report and reject 13 degradations: a missing session, metadata or historical-diagnostics file; a dropped metadata case; skipped, todo or failed cases; below floor; `success:false`; unreadable or missing report; and a real suite run with its configuration removed (which exits 1), plus that run's report. Without configuration the suite **throws**; it never skips. `pnpm test` stays database-free.

At independently reviewed head `2aedaee`, all three GitHub checks passed: standard CI, PostgreSQL isolation, and the new Auth workflow. Later commits need their own CI results and independent review of the exact final head.

## 6. Operator checks (prepared, not applied)

Exact patch: [`bru-492-operator-config.patch`](bru-492-operator-config.patch), against `orchestrator/config/repos/bernacle/analyticool.yaml`. `git apply --check` passes. It adds one required check, `auth-metadata`, which runs `verification/auth-metadata/run-checks.sh`. Agents, existing checks, budgets, permissions, forbidden paths, sandbox requirement and manual merge are unchanged. It adds no `isolation.read_paths` entry and does not require broader sandbox permissions or trust renewal. The operator uses a private state directory outside HOME, `/Users/Shared/analyticool-bru492-<uid>`, which the existing profile can read but cannot write. State remains synthetic and disposable; no production credentials are stored there.

Run sandboxed under the orchestrator's own generated Seatbelt profile, the check body:

- originally passed 28/28 plus 11 gate checks with the suite present;
- originally fell back to health-only success on any ref without the runner, which independent review correctly rejected;
- now requires the runner on every ref, including the baseline, and **fails** when the runner or running stack is absent. Apply this check only after preparation is merged. The revised body was tested against a candidate directory without the runner and rejected it. No baseline exception remains.

Operator recipe, unsandboxed and before `orchestrator preflight` or a run:

```sh
export ANALYTICOOL_AUTH_STACK_STATE="/Users/Shared/analyticool-bru492-$(id -u)"
# Refuse an existing symlink, foreign owner or non-directory. mkdir fails on a raced creation.
if [ -e "$ANALYTICOOL_AUTH_STACK_STATE" ] || [ -L "$ANALYTICOOL_AUTH_STACK_STATE" ]; then
  [ ! -L "$ANALYTICOOL_AUTH_STACK_STATE" ] &&
    [ -d "$ANALYTICOOL_AUTH_STACK_STATE" ] &&
    [ -O "$ANALYTICOOL_AUTH_STACK_STATE" ] || exit 1
else
  (umask 077; mkdir "$ANALYTICOOL_AUTH_STACK_STATE") || exit 1
fi
chmod 700 "$ANALYTICOOL_AUTH_STACK_STATE"
bash verification/auth-metadata/stack.sh prefetch   # needs network; pulls by digest
bash verification/auth-metadata/stack.sh start      # loopback-only, writes state
# … preflight / run (checks reach only 127.0.0.1:55421 / :55422) …
bash verification/auth-metadata/stack.sh stop
```

**Historical isolation finding (orchestrator, not this repository):** the check profile contains `(allow network-outbound (remote unix-socket))`. Under a profile generated by `orchestrator/dist/core/isolation.js` (network `none`), `curl --unix-socket /var/run/docker.sock …/_ping` returns `OK`. Any check, including agent-written tests, can therefore drive the Docker daemon, which is host-level power, whether or not this stack exists.

Original targeted experiment: deny `/var/run/docker.sock` and the OrbStack socket; those paths became unreachable while loopback Auth still worked. Independent review noted that two path denies miss aliases, alternate runtimes and the outbound setup profile. Recommended hardening is default-deny outbound Unix sockets in both setup and check profiles, with only demonstrated necessary test sockets allowed. It needs separate engine-repository authorization, generated-runtime rebuild and real sandbox regression checks before any live run. The separately reviewed engine fix is in Orchestrator PR #11. It remains a live-run blocker until manually merged and the installed runtime is rebuilt and verified. This preparation PR changes no engine files.

## 7. Verification evidence

Final local run, Node 24.21.0, pnpm 10.34.9, Docker 29.4.0 (OrbStack), macOS arm64.

| Check                                                                                                                       | Result                                                                       |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`                                                            | pass                                                                         |
| `pnpm test` (no `ANALYTICOOL_*` variables)                                                                                  | 9 files, 246/246                                                             |
| `pnpm verify:net-receipts`; `python3 -I verification/net-receipts/oracle.py`                                                | 75 cases, 7/7 variants, report `sha256:be52ef10…4971` unchanged; exit 0      |
| BRU-461 suite (`PGBIN=/opt/homebrew/opt/postgresql@17/bin bash verification/postgres-isolation/run-local.sh`) plus its gate | **93/93**, 0 skipped (PostgreSQL 17.11); `ci.yml` and floor unchanged        |
| `bash verification/auth-metadata/run-checks.sh` (stack running)                                                             | **71/71** (39 + 26 + 6) + gate OK + 14/14 gate-negative, incl. real Chromium |

Reproduce: install the pinned CLI (§2), `stack.sh prefetch && stack.sh start`, then `bash verification/auth-metadata/run-checks.sh`, then `stack.sh stop`.

The shared host was heavily loaded during this run (load average ≈ 76 from unrelated containers), and GoTrue requests took 2–10 s. The test server therefore uses a 20 s Auth bound; the harness default stays 5 s. No assertion was relaxed. One earlier run failed a login on the 5 s bound before this change.

Limits: one local machine; CI for this head is reported in the PR handback. Hosted Supabase ACLs and limits are not verified, and there is no Next.js integration yet (that is PR 1). The Orchestrator Unix-socket fix (§6) is separate and still requires manual merge and installed-runtime verification.

**Gate to the next phase:** this ADR reaches `origin/main` only when a human merges this draft PR. Until then the Orchestrator's `base_branch: main` does not contain it, and no phase dry run should rely on it. PR 1 also waits on the operator patch being reviewed and applied after merge, and on separate engine hardening. Usage was not tool-metered here.

## 8. Independent review corrections (2026-11-16)

Codex requested changes on exact head `2aedaee`: P1 false confirmed logout after a rejected Auth request; P2 health-only operator fallback on candidate refs; P2 overstated timebox test comment. The missing metadata probe was an intentional gate, not a passing result.

- **P1 fixed in the verification harness:** obtain the current bearer only for logout, call the pinned GoTrue `/logout?scope=local` endpoint directly with a five-second timeout and require its explicit HTTP 204 acknowledgement. Do not infer remote revocation from SDK `error: null`, which suppresses 401/403/404. Every outcome clears all cookie chunks. A real banned-account regression now returns unconfirmed logout while the remote row survives; after unban captured cookies and refresh tokens still work, accurately demonstrating the distinction. Three additional rejected HTTP status cases also remain unconfirmed. The latter are transport fault injection with real authenticated sessions, not three claims about distinct GoTrue behaviors.
- **P2 operator fallback removed:** the unapplied config patch requires the runner for baseline and candidate refs. A deleted runner fails instead of degrading to a health check. Preparation must merge before applying this check; a base ref without the preparation suite deliberately fails.
- **P2 timebox evidence corrected:** database backdating is not signed-AMR aging. The original ADR is not amended by correcting this claim.
- Added CI JSON-report retention. Lint, types, formatting and the corrected 32-case integration suite plus 11 gate checks pass locally. No dependency or calculation changes in this correction.

At the time of these corrections the amendment was still a proposal. It was accepted afterwards (§9).

## 9. Amendment adoption and completed preparation (2026-11-16)

- The owner approved the [Auth-boundary amendment](bru-492-auth-boundary-amendment.md). It is incorporated into ADR §2/§3/§5/§6 and marked accepted.
- The verification harness now implements the accepted contract (§4b): same-token fresh `getUser`, signed-AMR eight-hour limit with an explicit 60 s future-clock policy, and bounded Auth calls.
- Added the metadata RLS/definer pattern probe as the actual runtime login (26 cases) and the Auth-outside-transaction retry driver.
- The old predicate probes are kept as rejected-design diagnostics (§4a). No coverage was retired, and every floor rose or stayed.
- No dependency, lockfile, `ci.yml`, `postgres-isolation.yml`, engine, Orchestrator config or trust change. The operator patch is still unapplied.

Remaining: independent review of the final head, human merge, operator patch application, Orchestrator Unix-socket hardening (separate authorization), and the Phase 1 dry run.
