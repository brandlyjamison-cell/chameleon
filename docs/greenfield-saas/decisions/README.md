# Decisions (ADRs)

One file per irreversible or expensive-to-reverse choice. Format: status, context,
decision, consequences, rejected alternatives, reversal cost.

An ADR is required before merge for: plane boundaries, schema shape on `links` or
`captures`, key hierarchy, provider choices, hostname lifecycle, and the 404.

Index:

| ADR  | Title                                                 | Status   |
| ---- | ----------------------------------------------------- | -------- |
| 0001 | Two planes as separate deployables                    | accepted |
| 0002 | Postgres on Neon behind Hyperdrive                    | accepted |
| 0003 | RLS forced on every tenant table                      | accepted |
| 0004 | Capture is enqueued, never written in-request         | accepted |
| 0005 | Per-service DEK with envelope encryption              | accepted |
| 0006 | Gate modes rewrap the DEK, passcode persists          | accepted |
| 0007 | Service types behind an engine registry               | accepted |
| 0008 | KV is the resolution authority with Postgres as truth | accepted |
| 0009 | Crypto-only billing via NowPayments                   | accepted |
| 0010 | Slug format and minting rules                         | accepted |
| 0011 | Hostnames are tombstoned, not freed                   | accepted |
| 0012 | The expiry 404 is unbranded and byte-exact            | accepted |
| 0013 | Static skeleton, never iframes                        | accepted |
| 0014 | Cloudflare for SaaS for hostnames                     | accepted |
| 0015 | Browser Rendering for profile capture                 | accepted |
| 0016 | Better Auth for platform identity                     | accepted |
| 0017 | Admin is blind to capture plaintext                   | accepted |
| 0018 | The demo runs on an isolated throwaway tenant         | accepted |
| 0019 | `kind` is written by the engine, not the route        | accepted |
| 0020 | Vault verification runs on the data plane             | accepted |
| 0021 | Manual deploy with a local gate, no CI pipeline       | accepted |

Last reviewed: 2026-11-20
