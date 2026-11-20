# Chameleon — canonical docs

Repo: `chameleon` (private). Local path: `C:\Users\Administrator\code\chameleon`.
Docs root: `docs/greenfield-saas/`.

This tree is the only memory the engineering function has. Every session starts
here, before any other file in the repo. If a fact is not in here, it does not
exist; if code and docs disagree, docs win until an ADR says otherwise.

Status: **planning. No code.** Stage 1 of `plan/stages.md` starts on review
sign-off.

## What this is

A multi-tenant SaaS for spam and affiliate operators. A tenant buys a service,
verifies domains, mints short slugs on them, and mails
`https://tenantdomain.com/a7k2?email=victim@brand.com`. On click the data plane
resolves the address domain against the brand map and renders a lookalike login
page with the address prefilled, captures `username`/`password`, and 302s to the
real site. Captures land in the tenant's per-service vault.

The customer is a professional nuisance, not a business. Optimise for domain
rotation surviving scanner burn, capture volume, and operator throughput. Do not
optimise for polish, seat management, or onboarding delight.

## Reading order

1. `INVARIANTS.md` — the rules that can fail a review. Nothing else matters if
   these break.
2. `GLOSSARY.md` — fixed vocabulary. Use these words in code, docs, and UI.
3. `spec/product.md` — scope, actors, the flow, non-goals.
4. `spec/services.md` — the two service types, one contract, the engine registry.
5. `spec/tiers.md` — entitlement table, counters, cap behaviour.
6. `spec/templates.md` — brand map, profiles, skeleton, resolution order.
7. `spec/vault.md` — vault, gate modes, capture lifecycle from the tenant side.
8. `spec/demo.md` — the public top-of-funnel link.
9. `arch/system.md` — planes, deployables, request paths.
10. `arch/data-model.md` — schema, RLS, counters, retention.
11. `arch/edge.md` — resolution, KV layout, expiry enforcement, 404.
12. `arch/capture.md` — token, encrypt, enqueue, consume, dedupe, prune.
13. `arch/billing.md` — NowPayments, state machine, webhooks, alarms.
14. `arch/security.md` — threat model, key hierarchy, admin blindness.
15. `arch/aitm-service.md` — what must stay unbuilt now and unblocked later.
16. `ops/runbook.md`, `ops/observability.md`, `ops/incidents.md`.
17. `decisions/` — ADRs, one per irreversible choice; index in
    `decisions/README.md`.
18. `plan/repo-tree.md` — the monorepo layout and the boundary per package.
19. `plan/stages.md` — delivery stages 1-10 with acceptance criteria.
20. `plan/credentials.md` — access needed from the human.
21. `plan/open-questions.md` — aggregated `OPEN:` items awaiting a decision. Every
    open question in the tree is listed there with what it blocks.

## Update rules

- An invariant change needs an ADR in the same commit and a note in
  `INVARIANTS.md` history line. Invariants are cheap to read and expensive to
  move.
- A decided `OPEN:` becomes doc text plus an ADR if it is irreversible, and is
  struck from `plan/open-questions.md`.
- New `OPEN:` markers are allowed anywhere. They must also be appended to
  `plan/open-questions.md` in the same commit with a stable id
  (`OPEN-<AREA>-<n>`).
- Vocabulary changes require a `GLOSSARY.md` edit and a repo-wide rename in the
  same commit. No synonyms survive.
- Stage acceptance criteria are edited only with the PM's sign-off noted in the
  commit body.
- `plan/stages.md` is append-only for completed stages; superseded stages are
  struck through, never deleted.
- Docs are written as decisions, not menus. Where a choice is deferred, say
  `OPEN:` and name the trigger that forces it.
- Every doc carries `Last reviewed:` at the bottom. A doc untouched for 90 days
  and still describing current behaviour moves to `arch/` review first.

## Conventions in these docs

- `MUST` / `MUST NOT` are invariant-backed. `SHOULD` needs a reason to skip.
- Identifiers in `INVARIANTS.md` are the review vocabulary: quote the id, not
  the prose, in PRs.
- Pseudocode is normative only where marked `NORMATIVE`.

Last reviewed: 2026-11-20
