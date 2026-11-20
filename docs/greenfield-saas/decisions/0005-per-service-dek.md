# ADR 0005 — Per-service DEK with envelope encryption

Status: accepted (2026-11-20)

## Context

Captures are the crown jewels and multiple code paths touch them: the edge seals,
the consumer stores, the vault reads, the webhook decrypts. A single platform key
makes every one of those a path to everything, and a leak is total.

## Decision

A 32-byte DEK per service, AES-256-GCM, generated at activation, never stored
raw. It is wrapped, and the wrapping key depends on gate mode (ADR 0006). AAD binds
`link_id|capture_id|email_hash` so a ciphertext cannot be replayed onto another row.

Rows store `{v,alg,iv,ct}`; the DEK never leaves a Worker.

## Consequences

- A leaked DEK exposes one service.
- Every read needs an unwrap, which is the gate's cost and its proof.
- Rotation is per service and can be done during business hours.
- The AAD means moving a row requires re-encryption, so a service-to-service move
  is a job, not an UPDATE.
- Payload envelopes in R2 use the same DEK, so a pruned row's object is useless
  once the DEK is rotated.

## Rejected

- **One platform key.** Fast, and one compromise is every tenant.
- **KMS-per-row.** Latency and cost per capture.

## Reversal cost

High. Rotation to a different scheme is a full re-encrypt of every service, hours
per large service.

Last reviewed: 2026-11-20
