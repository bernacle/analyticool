# BRU-492 Auth boundary amendment — proposed, not adopted

2026-11-16. Requires owner approval before the dependent metadata probe proceeds. The approved [Metrics Library ADR](persistent-metrics-library.md) remains unchanged. This proposal follows the [preparation evidence](bru-492-preparation-report.md) and independent Codex review of PR #12 at `2aedaee` (request changes).

## Decision requested

Replace the application's direct managed-Auth-table predicate with fresh Supabase Auth validation on every protected server operation. Give application/runtime/metadata-owner roles **no access to managed Auth tables and no BYPASSRLS**. Keep the current membership checks, FORCE RLS, transaction-local context and NOLOGIN/NOBYPASSRLS metadata owners.

The six real database probes establish that a non-bypass predicate cannot read Supabase's policy-less RLS Auth tables under the approved constraints. They do not establish that the application needs a second session check inside the metadata database. The alternative dedicated BYPASSRLS owner inherits other `anon` privileges as well; narrow Auth column grants do not bound all of that authority. Do not adopt that alternative by default.

Pinned GoTrue v2.197.0 checks the token's session row and rejects a missing session during authenticated `/user` requests; it also rejects banned users. Supabase recommends server `getUser()` where revoked-session detection matters. This supports the simpler design within the ADR's already-trusted backend boundary. See [pinned authentication code](https://github.com/supabase/auth/blob/v2.197.0/internal/api/auth.go) and [official SSR guidance](https://supabase.com/docs/guides/auth/server-side/advanced-guide).

## Exact ADR changes to adopt only after approval

- **§2, session validation:** obtain and verify the effective Supabase access token, then validate that same token with a fresh server `getUser()` for every protected operation and retry. Check matching subject, supported non-anonymous account, issuer/audience/expiry and session identifier. No authentication cache across requests; outages/timeouts/errors deny access. Session contents, user metadata and cookie age grant no authority.
- **§2, eight-hour limit:** enforce login age from verified password-login AMR timestamps preserved across refresh. Require finite positive integer timestamps and the supported password method; deny malformed timestamps and timestamps more than 60 seconds ahead of server time. The 60-second tolerance applies only to future-clock validation, never to extending the eight-hour deadline. Use the earliest supported password-login timestamp. Refresh/`iat` must not restart the deadline. Retain 15-minute tokens and eight-hour absolute sessions.
- **§2, logout:** always clear all local session-cookie chunks. Report confirmed remote revocation only after explicit acknowledgement from GoTrue's current-session logout endpoint; SDK `error: null` alone is insufficient. Rejections, unavailable Auth and ambiguous outcomes report local logout with remote revocation unconfirmed. Subsequent protected requests require fresh Auth validation.
- **§3:** remove the managed-Auth-table predicate and its privilege grants. Bind verified identity/session references for attribution only; authorize workspace operations against current metadata memberships and FORCE RLS.
- **§5:** Auth verification precedes the bounded metadata transaction. Inside it, lock/recheck current membership and enforce lifecycle, concurrency and idempotency as already specified. Every transaction retry repeats Auth validation. Never perform remote Auth calls while holding membership/metric locks.
- **§6:** distinguish successful session tests from the probes demonstrating the rejected predicate design. Require the additional protected-request tests below and the still-missing real metadata RLS/definer suite before declaring preparation complete.

## Explicit limits accepted by this proposal

Auth verification and metadata commit are separate operations. A revocation/ban after successful Auth validation can race with already-authorized, bounded in-flight work; subsequent validations deny access. There is no claim that logout serializes with metadata commits. The original predicate would narrow that interval, not automatically remove it.

The metadata database no longer independently verifies managed session ownership, existence, `created_at` or `not_after`. Supabase Auth confirms current user/session status; the application separately enforces its signed-login eight-hour limit. This does not claim to enforce every possible GoTrue session policy. AMR is a pinned provider contract requiring upgrade regression tests, not an independently maintained session registry. Host clock correctness remains an operational requirement.

The existing test that backdates only database `created_at` while retaining fresh signed AMR proves `/user` does not enforce that database timebox. It does **not** demonstrate an eight-hour-old login bypassing the application limit.

## Evidence required before accepting the amended design as validated

1. Protected HTTP requests using real GoTrue-signed password-login timestamps just before and at eight hours, including refresh preservation. Backdate the disposable Auth authentication-method record before minting the token; do not replace a signature with test-made claims. Verify malformed/unsupported/future timestamp handling separately.
2. Successful claim verification followed specifically by `getUser()` outage, timeout or 5xx; unchanged issuer and valid signature. The existing wrong-issuer/unavailable-stack case does not isolate this path.
3. External session revocation, ban, hard deletion and supported soft deletion deny the next request. Match subject/session attribution and reject anonymous accounts. Direct edits to `deleted_at` are not equivalent to the provider's supported deletion operation.
4. Logout rejection regression, including ban, cookie clearing, and captured-token behavior after unban; no false claim that remote revocation succeeded.
5. Complete the actual runtime-role, FORCE RLS, membership, privilege-escalation and nonrecursive SECURITY DEFINER metadata probes without managed Auth-table access. Preserve all existing checks and fail-closed gates.

Items 1–3 and 5 are pending. The logout regression and fail-closed operator-runner correction are independent preparation fixes, not adoption of this proposal.

## Separate live-run blocker: Orchestrator Unix-socket isolation

The recorded check profile permits outbound connections to arbitrary Unix sockets, including Docker's host-control socket. Credential-read restrictions do not prevent those connections. Two hardcoded path denies would miss aliases and other runtimes.

Proposed separately scoped engine change: deny outbound Unix-socket connections by default in **both setup and check profiles**; allow only a demonstrated necessary test socket under the disposable test directory. Keep required loopback TCP tests working, verify daemon endpoints/aliases and any configured host TCP daemon endpoint are inaccessible, and rebuild/retest the generated runtime. Do not modify the engine's existing dirty repository configuration or relax sandbox requirements. No engine change has been made by this preparation PR.

Owner authorization is needed for this change in the separate Orchestrator repository. It strengthens isolation and is a prerequisite to live execution; it is not a reason to grant repository checks Docker access.
