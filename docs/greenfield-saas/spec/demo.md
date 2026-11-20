# Demo

Top of funnel. Public, no signup, one fixed link, one fixed brand, no custom
domain. It exists so a prospect can feel the product in one click, not so they
can run a campaign on it.

## Shape

- URL: `https://app.<platform>/demo` on the control host. The page explains in
  one line, then offers "Try it" with the fixed link.
- The fixed link is on the platform's own data host (`go.<platform>`) with a
  permanent slug, pinned to one brand chosen at build time (a two-step identity
  provider, because it demonstrates the harder case).
- The victim-side flow is the real flow: same skeleton, same capture POST, same
  302 out.

## After submit

The demo shows the captured row back to the visitor, once:

```
Captured in your browser session:
  jane@example.com   hunter2      2 seconds ago
  → this is what lands in a real vault
  [ Start a service ]
```

The row is short-lived, tied to the visitor's demo cookie, and shows the plain
value. It is deliberately readable: the point is the reveal.

`OPEN-DEMO-01`: show the password masked with a reveal toggle, or in the clear?
Lean: clear, because the visitor typed it a second ago and the reveal is the
demo.

## Isolation rules

- Demo captures belong to a `demo` tenant with `is_demo = true`, read-only in the
  dashboard, invisible to billing.
- They never count against any paid cap.
- IP rate limit: 30 demo renders per hour per IP, 60 per hour per /24.
  Over the limit, the demo page still loads but the link 404s with a demo note.
- Resets on a timer: `demoReset` cron purges demo tenants' captures every 24h and
  deletes R2 payloads. Nothing a visitor submits survives a day.
- The demo slug is vanity (`demo`) and cannot be minted by a tenant on the
  platform domain.
- Turnstile is **off** for the demo: an interstitial kills the effect and the
  flow is only one click.

## Why not a real throwaway account

A real account needs email verification, a passcode, and a domain before anything
works — 20 minutes to first impression. The demo shortens that to two clicks and
carries no security surface, because it is one pinned brand and one fixed link.

## Abuse

A demo tenant with a public link will be used for real blasts by cheap operators.
That is acceptable: it proves the product and the reset makes it clearly
temporary. Guardrails:

- Brand is pinned, so a blasting tenant cannot resolve arbitrary brands on the
  demo link.
- Slug is fixed, so scanners cannot enumerate.
- Redirect after capture goes to the pinned brand's real login, exactly as a real
  link would.
- If demo volume becomes a cost problem, `OPEN-DEMO-02`: add Turnstile behind a
  query flag (`?ts=1`) or tighten the IP limit rather than removing the demo.

## Metrics

- demo_view → demo_click → demo_capture → signup_start → service_activated.
- Tracked as Axiom events with a `demo_session` id, not cookies, so the funnel
  survives a cleared browser.
- A capture with no signup within 24h is the interesting drop; it means the
  reveal worked but the pitch did not.

## Copy constraints

- Never name the customer segment as "phishing" first; say "your victims will not
  notice" because operators know what phishing is and care about the tell.
- One sentence on the domain-rotation reason. It is the differentiator and it is
  not obvious.
- Price shown on the demo page ($19 floor). Operators hate a hidden price.

Last reviewed: 2026-11-20
