# QA — deploy 11 (console follow-up)

Run against https://app.mailerdeaon.bid. Record raw evidence per step.

1. Signed out: `/` 200 with "Start free"; `/login` 200; `/dashboard` 307 → `/login`.
2. Sign up `qa.d11.<epoch>@mailinator.com` (password ≥ 10 chars).
   - `POST /api/signup` → 303 `/welcome`.
   - `/dashboard` **200** (not a redirect) and shows the "Confirm … before
     activating" warning plus the rail, "New service".
   - `/welcome` status pill reads "Unconfirmed", not "Awaiting DNS".
   - `/account` email row reads "Unconfirmed".
3. Create a service (`POST /api/services` `serviceType=chameleon&tier=pro`).
4. `/services/<id>`: unpaid banner and "Subscribe — $…". Then set it paid in SQL:
   `update services set status='active', activated_at=now(), paid_at=now(),
paid_until=now()+interval '30 days', expires_at=now()+interval '30 days'
where id='<id>'`. Reload: links, hostnames, captures, forwarding, advanced
   all render.
5. Add a hostname at `/settings/domains` (`qa-<epoch>.example.com`).
   - TXT type, host/name, value and TTL are **visible without expanding
     anything**.
   - Each of the four fields has its own copy button; the whole record has one
     copy button; a CNAME target `edge.mailerdeaon.bid` is shown with its own
     copy buttons.
   - Guidance text and a "Check now" button exist.
   - Pressing "Check now" returns the **page** (after redirect), not JSON.
   - Repeat at 390px: no horizontal scroll (`scrollWidth <= innerWidth + 1`).
6. Set the row `status='failed'`. Reload: a plain-language cause appears, the
   row still shows its records, and "Check now" answers 303 (not 404).
7. Admin: `/admin` as the tenant → 307 `/dashboard`. Flag the user, reload →
   200 "Operator panel"; the org table shows the owner address under the org
   name without colliding with the services/captures columns (no overlap of
   visible text at 1360px and 390px).
8. `/api/health` 200 `ok:true`; POST garbage to `/api/payments/ipn` → 403.
9. Mobile 390px: `/dashboard`, `/services/<id>`, `/vault`, `/settings/domains`,
   `/admin` all `scrollWidth <= innerWidth + 1`, Menu button present.
10. Timers active; `_migrations` contains 0017–0024; prod branch still
    `ep-cold-sunset-bd7piew6`.
