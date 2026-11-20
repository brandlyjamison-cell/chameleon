# ADR 0006 — Gate modes rewrap the DEK; the passcode persists

Status: accepted (2026-11-20)

## Context

The gate is sold as a real lock, but one mode turns it off. If `off` discarded the
passcode, re-arming would force a new one and the "off is temporary" promise
breaks. If `off` kept the DEK wrapped only under the passcode, the platform could
not read a vault for support or for an unwarmed capture.

## Decision

Three modes. In `always` and `remember_30d` the DEK is wrapped under
PBKDF2-SHA-256(passcode, 310k, per-service salt). In `off` it is rewrapped under the
platform KEK. `passcode_hash`, `passcode_salt`, and the last passcode-wrapped blob
are kept on every transition, so `off → always` re-arms with the existing passcode
and one verification.

`dek_wrap_kind` is authoritative; a mismatch is a hard error, never a fallback.

## Consequences

- `off` genuinely means the platform can open the vault, and the UI says so.
- Re-arming is one transaction: verify, rewrap, drop device cookies, fresh CSRF.
- Losing the passcode in a gated mode loses the vault; stated at setup.
- Rotation re-wraps only, never re-encrypts rows.

## Rejected

- **Discard the passcode on `off`.** Breaks re-arm, and support cannot explain it.
- **Keep the DEK wrapped under both always.** Removes the platform's ability to
  help and weakens the gate's meaning.

## Reversal cost

Low for the modes themselves, high for a tenant who chose `off` on a base of
25k rows and now needs it gated — the rewrap is cheap but the trust story changes.

Last reviewed: 2026-11-20
