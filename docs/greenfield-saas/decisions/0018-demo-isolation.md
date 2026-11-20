# ADR 0018 — The demo runs on an isolated throwaway tenant

Status: accepted (2026-11-20)

## Context

The demo must show the whole mechanic in two clicks, with no signup. That means a
public, unauthenticated capture path — which is exactly the thing tenants pay for.
It also must not need domain setup.

## Decision

One fixed link on the platform's own data host, pinned to one two-step brand, owned
by a `is_demo` tenant. IP limited, 24h reset, captures never counted, read-only in
the dashboard. After submit the visitor sees its own row once with a signup CTA.

## Consequences

- Full mechanic on the platform host, no DNS wait.
- Cheap operators will blast it; the pin and the limit are the guardrails.
- A public capture path needs the same encryption, so the demo exercises the real
  pipeline, which is a feature for QA.
- Demo volume can be cost-shaped by the limit without a code change.

## Rejected

- **A real signup for the demo.** Email verification and a passcode before the
  first impression.
- **A mock with no POST.** Proves nothing; the reveal is the demo.

## Reversal cost

Low. Tenancy flag and a cron; nothing else depends on it.

Last reviewed: 2026-11-20
