# Acceptance — flow-arch directive

Every scenario is an automated assertion; the file is the map from the directive
to the proof. Run the whole gate with `pnpm run ci` (112 tests at the time of
writing). Scenario IDs are stable so a regression report can cite one.

| #   | Scenario                                                                | Proof                                                                   |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | A root is added once and hands over a TXT + wildcard, not per-host DNS  | `domains.test.ts` "adds a root as pending…", "goes active only when…"   |
| 2   | A second service consumes a hostname under the verified root, no DNS    | `domains.test.ts` "shares one verified domain across services…"         |
| 3   | A subdomain typed as a domain is refused; a pasted URL becomes a root   | `domains.test.ts` "refuses a subdomain and normalises…"                 |
| 4   | A hostname on an unverified domain is refused                           | `preview.test.ts` (domain_not_verified path), `domains.test.ts` cap     |
| 5   | A deleted hostname is held and its own org revives the same row         | `flow-arch.test.ts` "holds a deleted hostname for 30 days…"             |
| 6   | A deleted root is held from another org for 30 days                     | `flow-arch.test.ts` "keeps a tombstoned domain from another org…"       |
| 7   | Every new service gets exactly one free preview and spends no link slot | `preview.test.ts` "mints exactly one free preview…"                     |
| 8   | A preview serves with zero DNS and no cookies, `noindex`                | `preview.test.ts` "serves the preview before any DNS exists"            |
| 9   | A cloned page renders its own brand; accept/reject changes the render   | `preview.test.ts` "clones a real page shape…", "falls back to cPanel…"  |
| 10  | A two-step clone shows email then password, no OTP field                | `preview.test.ts` "renders the email step of a two-step clone"          |
| 11  | A preview capture lands in the vault, dedupes, redirects to the action  | `preview.test.ts` "stores a credential and redirects…", "dedupes…"      |
| 12  | Every preview deny is the constant 404, including archive and pause     | `preview.test.ts` "returns the constant 404…", "404s once the service…" |
| 13  | Forwarding is off by default, shows "Awaiting confirmation", no DNS     | `flow-arch.test.ts` "leaves capture forwarding off…", "shows the…"      |
| 14  | A comped service never shows "Resume payment"; a lapsed one does        | `flow-arch.test.ts` "never asks a comped service to resume payment"     |
| 15  | Nav is Overview / services / Vault / Organization / Account, no mail    | `flow-arch.test.ts` "keeps mail delivery out of the tenant rail…"       |
| 16  | Admin has its own rail on every page and backend authorisation          | `flow-arch.test.ts` "gives the operator its own rail…", `admin.test.ts` |
| 17  | Publishing the zone to Pro promotes waiting roots with no code change   | `domains.test.ts` "proves the TXT but parks at routing…", "goes active" |

## Not covered by an assertion

- Real Cloudflare custom-hostname issuance. The probe path is exercised against a
  stub `1404`; the live zone is Free, so no test can pass through real issuance
  until it is upgraded (OPEN-OPS-04).
- The preview render on the edge worker. `/p/*` is served by control today
  (ADR 0033); the edge proxy is stage 5.
- Asset storage size limits. Bytes live in Neon; R2 is the documented next step
  (OPEN-ASSET-01).

## Manual smoke already run on the dev box

Signup → verify → create service → preview link appears with no DNS → clone
`https://github.com/login` → preview renders the GitHub title, logo and theme
colour with a blurred backdrop → submit a credential → 303 to
`https://github.com/session` → the row is in `/vault`. Preview mint left
`link_slots_used` at 0. Admin list, tenant detail and the `/a/<id>` asset route
were fetched with the flag set, and an anonymous `/admin` redirected to `/login`.
