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
| 0021 | Manual deploy; gate runs locally and in CI            | accepted |
| 0022 | One login per org; admin is a flag on the human       | accepted |
| 0023 | The VPS runs the control plane only                   | accepted |
| 0024 | Sessions, passcodes and verification boundaries       | accepted |
| 0025 | Domain verification by DoH, 30-day tombstone          | accepted |
| 0026 | Billing is per service, payment before activation     | accepted |
| 0027 | One mail queue; forwarding targets prove themselves   | accepted |
| 0028 | Console IA and white service surfaces                 | accepted |
| 0029 | Provider is the payment authority; `finished` credits | accepted |
| 0030 | DB rate limits and a money-driven lifecycle sweep     | accepted |
| 0031 | Operator surfaces: flag plus definer, not a role      | accepted |

Last reviewed: 2026-11-22
| 0032 | Domains belong to the org, hostnames to the service | accepted |
| 0033 | A free preview link lives on a platform path | accepted |
| 0034 | Clones are reviewable profiles with a fixed order | accepted |
| 0035 | Service names are tenant-chosen, unique per org | accepted |
| 0036 | The operator panel is tenant-first with its own rail | accepted |
