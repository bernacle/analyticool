# BRU-492 preparation report

Status: **Preparation partly complete, stopped at a design gate.** Date 2026-11-16. Baseline `main` = `01c2f46`. Implements only the authorized preparation in [the approved ADR](persistent-metrics-library.md) §7. No application route, production schema, migration, service, feature or deployment is added. The demo behaves exactly as before.

| ADR §7 preparation item                      | Result                                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Dependency pins, lockfile, evidence regen | Done (§1)                                                                                                                                   |
| 2. Disposable local Supabase Auth + Postgres | Done (§2)                                                                                                                                   |
| 3. Server-only HttpOnly cookie integration   | **Passed**: 22/22 against real GoTrue (§3)                                                                                                  |
| 4. Runtime role / FORCE RLS / definer probe  | **Blocked at the design gate**: the Auth-session predicate cannot be built as written (§4). The dependent metadata RLS probe was not built. |
| 5. Separate fail-closed CI workflow          | Done for the suites that exist (§5). Floors rise when the item 4 probe lands.                                                               |
| 6. Operator check/setup patch                | Prepared, not applied (§6). A **pre-existing sandbox hole** was found: checks can reach the Docker socket.                                  |
| 7. Baseline verification                     | All green (§7)                                                                                                                              |

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

## 3. Server-only HttpOnly session: passed

Artifacts in `verification/auth-metadata/`:

- [`cookie-policy.ts`](../../verification/auth-metadata/cookie-policy.ts), the ADR §2 `getAll`/`setAll` adapter.
- [`session-server.ts`](../../verification/auth-metadata/session-server.ts), a plain `node:http` login/me/logout flow. It is not a Next.js route and no browser SDK is involved.
- [`auth-session.test.ts`](../../verification/auth-metadata/auth-session.test.ts).

The adapter buffers SDK writes and re-issues **every write and deletion of every chunk** as `HttpOnly; Secure; SameSite=Lax; Path=/`, with no Domain and no Expires. Max-Age is capped at the remaining 8 h from the signed `amr` login time. A session it cannot bound is written as a deletion. A write after the response is committed is a detected violation. `encode: "tokens-only"` keeps the user object out of cookies. The SDK's own defaults would be `httpOnly: false` with a 400-day Max-Age. `authenticate()` runs `getClaims()` (ES256 signature and exp), checks issuer, audience, role and UUID sub/session_id, checks the 8 h limit from the signed `amr` time, then runs `getUser()` to confirm the current account.

**22/22 passed.** These cases cover:

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
- logout revokes the `auth.sessions` row, deletes every chunk, and defeats replay of both tokens
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
- **`/user` accepts an unexpired access token after the 8 h timebox.** Only refresh is refused (`session_expired`). The server-side `amr` check closes this. The ADR's database-time session-age predicate would add defense in depth, but it is blocked (§4).
- **`Referrer-Policy: no-referrer` breaks Origin checks.** With it, Chromium sends `Origin: null` on same-origin form POSTs, so the login was refused. Use `same-origin` or `strict-origin-when-cross-origin`. This applies equally to Next.js Server Action Origin checks.
- **Oversized JWT claims break the gateway.** An 8.8 KB access token from large `user_metadata` makes Kong return 400 on `/logout` and `/user`. Keep user metadata small.

## 4. Design gate: Auth-session predicate blocked

ADR §2/§3 ask for a narrowly granted, read-only predicate that checks the verified subject and `session_id` against an active `auth.sessions` row. Its SECURITY DEFINER owner is to be **NOLOGIN/NOBYPASSRLS**, with no change to the managed Auth schema. Against the real Supabase Postgres image, using the hosted-realistic migration credential `postgres` (non-superuser, BYPASSRLS, CREATEROLE), this cannot be built. [`auth-predicate-gate.test.ts`](../../verification/auth-metadata/auth-predicate-gate.test.ts) records it (6/6; every probe is rolled back):

| Probe                                                                                         | Observed                                                                                                                                                    |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform facts                                                                                | `auth.sessions`/`auth.users`: RLS enabled (not forced), **0 policies**. `postgres` has `SELECT WITH GRANT OPTION` but **no grant option on schema `auth`**. |
| **A**: dedicated NOLOGIN/NOBYPASSRLS owner, column grants                                     | `GRANT USAGE ON SCHEMA auth` grants nothing; reading fails with `42501`.                                                                                    |
| **A2**: same, with schema usage inherited from `anon`                                         | Runs, but sees **0 rows** because RLS has no policy. Adding a policy would alter the managed Auth schema.                                                   |
| **C**: dedicated NOLOGIN **BYPASSRLS** owner, `anon` membership for usage, column-only SELECT | Reads the row. Other columns and UPDATE give `42501`.                                                                                                       |
| **B**: fixed-body definer owned by `postgres` (Supabase's documented pattern)                 | Reads the row. The owner is broadly privileged.                                                                                                             |

Per the preparation brief, I stopped here. The FORCE RLS, membership and SECURITY DEFINER metadata probe embeds this predicate in its policies, so it was **not built**, and the ADR was not changed to work around it.

**Proposed smallest adjustment, for owner/ADR decision:** adopt **C**. The predicate gets its own NOLOGIN role with BYPASSRLS, column-only `SELECT` on `auth.sessions(id, user_id, created_at, not_after)` and `auth.users(id, banned_until, deleted_at)`, `anon` membership solely for schema usage, and no other grants. It owns exactly one fixed-body `SECURITY DEFINER` function with `search_path = pg_catalog, pg_temp`, schema-qualified references and PUBLIC EXECUTE revoked. EXECUTE goes only to the runtime login and the metadata owner. All **metadata** definers keep the ADR's NOLOGIN/NOBYPASSRLS, FORCE RLS owner. The ADR wording would change from "NOLOGIN/NOBYPASSRLS owner" to "except the isolated Auth-session predicate owner, which needs BYPASSRLS because Supabase enables policy-less RLS on Auth tables".

Residual risk of C: through `anon`, the role inherits Data API grants on `public` (Supabase default privileges), with RLS bypassed. Only the fixed function body can use them, because nobody can SET ROLE to it. Option B is simpler, but its owner can read everything. A third option, relying only on GoTrue `getUser` (which already rejects revoked sessions) plus the signed `amr` 8 h check, drops the ADR's database-time check and is not recommended. Hosted Supabase ACLs are assumed to match the local image; confirm that on the real project before PR 1.

## 5. CI and fail-closed gates

[`.github/workflows/auth-metadata.yml`](../../.github/workflows/auth-metadata.yml) is a new workflow; `ci.yml` and `postgres-isolation.yml` are untouched. It:

1. installs the checksum-pinned CLI;
2. runs `stack.sh prefetch/start` with digest and loopback verification;
3. installs Chromium;
4. runs the suite with a JSON report;
5. runs [`assert-auth-metadata-report.mjs`](../../scripts/assert-auth-metadata-report.mjs), which fails if a file is missing, any case is skipped, todo or failed, or a count is below the floor (`auth-session` ≥ 22, `auth-predicate-gate` ≥ 6, total ≥ 28);
6. runs [`check-auth-metadata-gate.mjs`](../../scripts/check-auth-metadata-gate.mjs), the gate-negative proof.

The gate-negative script must accept the real report and reject 10 degradations: missing file, skipped, todo, failed, below floor, `success:false`, unreadable report, missing report, and a real suite run with its configuration removed (which exits 1). Without configuration the suite **throws**; it never skips. `pnpm test` stays database-free.

This workflow has not yet run on GitHub. It runs for the first time on this PR.

## 6. Operator checks (prepared, not applied)

Exact patch: [`bru-492-operator-config.patch`](bru-492-operator-config.patch), against `orchestrator/config/repos/bernacle/analyticool.yaml`. `git apply --check` passes. It adds one check, `auth-metadata`, which runs `verification/auth-metadata/run-checks.sh`, and one entry in `isolation.read_paths` (the state directory). Agents, the existing checks, budgets, permissions, forbidden paths, sandbox requirement and manual merge are unchanged. Changing `read_paths` re-triggers the trust approval.

Run sandboxed under the orchestrator's own generated Seatbelt profile, the check body:

- passes 28/28 plus 11 gate checks with the suite present;
- verifies only loopback reachability on a base ref without the suite;
- **fails** when the stack is not started.

Operator recipe, unsandboxed and before `orchestrator preflight` or a run:

```sh
bash verification/auth-metadata/stack.sh prefetch   # needs network; pulls by digest
bash verification/auth-metadata/stack.sh start      # loopback-only, writes state
# … preflight / run (checks reach only 127.0.0.1:55421 / :55422) …
bash verification/auth-metadata/stack.sh stop
```

**Pre-existing isolation hole (orchestrator, not this repository):** the check profile contains `(allow network-outbound (remote unix-socket))`. Under a profile generated by `orchestrator/dist/core/isolation.js` (network `none`), `curl --unix-socket /var/run/docker.sock …/_ping` returns `OK`. Any check, including agent-written tests, can therefore drive the Docker daemon, which is host-level power, whether or not this stack exists.

Tested fix: add `(deny network-outbound (remote unix-socket (path-literal "/var/run/docker.sock")))` and the same rule for `~/.orbstack/run/docker.sock` (or narrow the unix-socket allow). With it, the socket is unreachable (exit 7) and loopback Auth still returns 200. The full suite was also verified sandboxed. I recommend fixing this before any live run, independently of BRU-492. I made no orchestrator change.

## 7. Verification evidence

Node 24.21.0, pnpm 10.34.9, Docker 29.4.0 (OrbStack), macOS arm64.

| Check                                                                                                                       | Result                                  |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `pnpm lint`, `pnpm format:check`, `pnpm typecheck`                                                                          | pass                                    |
| `pnpm test` (no `ANALYTICOOL_*` variables)                                                                                  | 9 files, 246/246                        |
| `pnpm verify:net-receipts`; `python3 verification/net-receipts/oracle.py`                                                   | 75 cases, 7/7 variants; exit 0          |
| `pnpm build`                                                                                                                | pass                                    |
| BRU-461 suite (`PGBIN=/opt/homebrew/opt/postgresql@17/bin bash verification/postgres-isolation/run-local.sh`) plus its gate | **93/93**, 0 skipped (PostgreSQL 17.11) |
| `bash verification/auth-metadata/run-checks.sh` (stack running)                                                             | 28/28 + gate OK + 11/11 gate-negative   |
| The same suite inside the Seatbelt profile, scrubbed env                                                                    | 28/28                                   |

Reproduce: install the pinned CLI (§2), `stack.sh prefetch && stack.sh start`, then `bash verification/auth-metadata/run-checks.sh`.

Limits: one local machine. The GitHub workflow has not run yet. Hosted Supabase ACLs and limits are not verified. There is no Next.js integration yet; that is PR 1. Session-row correlation at database access is still undecided (§4).

**Gate to the next phase:** this ADR reaches `origin/main` only when a human merges this draft PR. Until then the Orchestrator's `base_branch: main` does not contain it, and no phase dry run should rely on it. The engine's base branch was not changed. PR 1 also waits on the §4 decision and on the operator patch being reviewed and applied. Usage was not tool-metered here; see the PR handback.
