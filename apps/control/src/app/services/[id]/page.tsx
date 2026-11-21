import { notFound, redirect } from "next/navigation";
import { NotFoundError } from "@chameleon/db";
import { requirePageSession } from "../../../server/session";
import { latestPayment } from "../../../server/billing";
import { addAddress, listAddresses, queueLatestCapture } from "../../../server/forwards";
import { getService } from "../../../server/services";
import {
  checkDomain,
  listDomains,
  removeDomain,
  requestDomain,
} from "../../../server/domains";

const errors: Record<string, string> = {
  email_unverified: "Verify your email before activating this service.",
  passcode_mismatch: "A passcode is already set with a different value.",
  invalid_input: "The passcode must be exactly 4 digits.",
  owner_only: "Only the org owner can do that.",
  bad_hostname: "That is not a hostname (no scheme, no path).",
  domain_exists: "That hostname is already attached here.",
  domain_tombstoned: "Another org used that hostname in the last 30 days.",
  cap: "No domain slots left on this tier.",
  zone_full: "The platform is at its live-domain ceiling.",
  not_found: "That domain is gone.",
  payment_required: "Pay for this service before activating it.",
  billing_off: "Payments are not configured on this host yet.",
  service_archived: "This service is archived.",
  address_cap: "Five forwarding addresses is the ceiling.",
  address_unverified: "Confirm that address before forwarding to it.",
  capture_malformed: "That capture has nothing to send.",
};

function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? "not_found";
}

export default async function ServiceDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    activated?: string;
    domain_added?: string;
    forward_added?: string;
    forwarded?: string;
  }>;
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
  const { error, activated, domain_added, forward_added, forwarded } = await searchParams;
  const live =
    service.status === "active" &&
    service.expiresAt !== null &&
    new Date(service.expiresAt) > new Date();
  const paid = service.paidUntil !== null && new Date(service.paidUntil) > new Date();
  const payment = paid ? null : await latestPayment(session, service.id);
  const price = `$${(service.priceCents / 100).toFixed(2)}`;

  return (
    <main className="app" id="content">
      <h1>{service.serviceType}</h1>
      <p className="muted">{service.id}</p>
      {error && <p className="error">{errors[error] ?? "That did not work."}</p>}
      {activated && <p className="muted">Activated. The 30-day clock is running.</p>}
      {domain_added && (
        <p className="muted">Hostname added. Publish the TXT record, then check.</p>
      )}
      {forward_added && (
        <p className="muted">
          Address saved. If it is not your signup address, confirm the link we sent.
        </p>
      )}
      {forwarded && <p className="muted">Latest capture queued for mail.</p>}

      <div className="card">
        <div className="row">
          <span>status</span>
          <strong>{service.status}</strong>
        </div>
        <div className="row">
          <span>entitlement</span>
          <strong>{live ? "active" : "expired"}</strong>
        </div>
        <div className="row">
          <span>tier</span>
          <span>
            {service.tier} · {price} / 30 days
          </span>
        </div>
        <div className="row">
          <span>paid through</span>
          <span>
            {service.paidUntil
              ? new Date(service.paidUntil).toLocaleDateString()
              : "unpaid"}
          </span>
        </div>
        <div className="row">
          <span>gate</span>
          <span>{service.gateMode}</span>
        </div>
        <div className="row">
          <span>expires</span>
          <span>
            {service.expiresAt
              ? new Date(service.expiresAt).toLocaleString()
              : "not activated"}
          </span>
        </div>
      </div>

      {!paid && (
        <section id="billing">
          <h2>Payment</h2>
          <p className="muted">
            Each service is billed on its own: {price} buys 30 days. Paying first keeps an
            unpaid service from holding a wrapped key nobody invoiced for.
          </p>
          {payment?.status === "pending" && payment.checkoutUrl ? (
            <p>
              <a className="btn" href={payment.checkoutUrl}>
                Resume payment
              </a>
            </p>
          ) : (
            <form action={`/api/services/${service.id}/checkout`} method="post">
              <button type="submit">Subscribe — {price} for 30 days</button>
            </form>
          )}
          {payment && <p className="fine">Last payment: {payment.status}.</p>}
          <p className="fine">
            Crypto only, through NowPayments. The period is fixed at checkout; a confirmed
            payment is what unlocks activation.
          </p>
        </section>
      )}

      {!service.activatedAt && paid && (
        <>
          <h2>Activate</h2>
          <p className="muted">
            Four digits wrap the service key. Lose them and the vault cannot be opened —
            not even by us.
          </p>
          <form action={`/api/services/${service.id}/activate`} method="post">
            <label>
              Vault passcode
              <input
                name="passcode"
                type="password"
                autoComplete="new-password"
                required
                inputMode="numeric"
                pattern="\d{4}"
                minLength={4}
                maxLength={4}
                placeholder="••••"
              />
            </label>
            <label>
              Gate
              <select name="gateMode" defaultValue="always">
                <option value="always">always — passcode every unlock</option>
                <option value="remember_30d">remember 30 days on this device</option>
                <option value="off">off — platform can open it</option>
              </select>
            </label>
            <button type="submit">Activate</button>
          </form>
        </>
      )}

      {service.activatedAt && !paid && (
        <p className="error">
          The paid period has ended. Renew above; links stop resolving once it lapses.
        </p>
      )}

      {service.activatedAt && <Domains id={service.id} session={session} />}
      {service.activatedAt && <Forwarding id={service.id} email={session.email} />}
    </main>
  );
}

async function Domains({
  id,
  session,
}: {
  id: string;
  session: Awaited<ReturnType<typeof requirePageSession>>;
}) {
  const domains = await listDomains(session, id);

  async function addDomain(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    try {
      await requestDomain(ctx, id, String(formData.get("hostname") ?? ""));
    } catch (error) {
      redirect(`/services/${id}?error=${codeOf(error)}`);
    }
    redirect(`/services/${id}?domain_added=1#domains`);
  }

  async function verifyDomain(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    try {
      await checkDomain(ctx, String(formData.get("domainId") ?? ""));
    } catch (error) {
      redirect(`/services/${id}?error=${codeOf(error)}#domains`);
    }
    redirect(`/services/${id}#domains`);
  }

  async function deleteDomain(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    try {
      await removeDomain(ctx, String(formData.get("domainId") ?? ""));
    } catch (error) {
      redirect(`/services/${id}?error=${codeOf(error)}#domains`);
    }
    redirect(`/services/${id}#domains`);
  }

  return (
    <section id="domains">
      <h2>Domains</h2>
      <p className="muted">
        A tenant hostname needs one TXT record, then TLS is issued for it. Verification
        retries every five minutes for 72 hours.
      </p>
      {domains.length === 0 && <p className="muted">No hostnames yet.</p>}
      {domains.map((domain) => (
        <div className="card" key={domain.id}>
          <div className="row">
            <strong>{domain.hostname}</strong>
            <span>{domain.status}</span>
          </div>
          <p className="muted">
            Publish <code>{domain.verifyValue}</code> as a TXT record at{" "}
            <code>{domain.verifyName}</code>.
          </p>
          {domain.detail && <p className="muted">{domain.detail}</p>}
          <div className="row">
            <form action={verifyDomain}>
              <input type="hidden" name="domainId" value={domain.id} />
              <button type="submit">Check now</button>
            </form>
            <form action={deleteDomain}>
              <input type="hidden" name="domainId" value={domain.id} />
              <button type="submit">Delete</button>
            </form>
          </div>
        </div>
      ))}
      <form action={addDomain}>
        <label>
          Hostname
          <input name="hostname" placeholder="login.acme.com" required />
        </label>
        <button type="submit">Add hostname</button>
      </form>
    </section>
  );
}

async function Forwarding({ id, email }: { id: string; email: string }) {
  const session = await requirePageSession();
  const addresses = await listAddresses(session);

  async function add(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    try {
      await addAddress(ctx, String(formData.get("email") ?? ""));
    } catch (error) {
      redirect(`/services/${id}?error=${codeOf(error)}#forwarding`);
    }
    redirect(`/services/${id}?forward_added=1#forwarding`);
  }

  async function sendLatest(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    try {
      await queueLatestCapture(ctx, id, String(formData.get("addressId") ?? ""));
    } catch (error) {
      redirect(`/services/${id}?error=${codeOf(error)}#forwarding`);
    }
    redirect(`/services/${id}?forwarded=1#forwarding`);
  }

  return (
    <section id="forwarding">
      <h2>Forwarding</h2>
      <p className="muted">
        Captures can also go straight to mail, queued through the platform sender. Your
        signup address ({email}) is trusted already; any other address must be confirmed
        first, so a typo cannot quietly swallow a capture.
      </p>
      {addresses.length === 0 && (
        <p className="muted">No forwarding addresses yet — the signup address works.</p>
      )}
      {addresses.map((address) => (
        <div className="card" key={address.id}>
          <div className="row">
            <strong>{address.email}</strong>
            <span className="pill">{address.status}</span>
          </div>
          <div className="row">
            <form action={sendLatest}>
              <input type="hidden" name="addressId" value={address.id} />
              <button type="submit" className="link">
                Forward latest capture
              </button>
            </form>
            <form action={`/api/forwards/${address.id}/delete`} method="post">
              <button type="submit" className="link">
                Remove
              </button>
            </form>
          </div>
        </div>
      ))}
      <form action={add}>
        <label>
          Add an address
          <input name="email" type="email" placeholder="you@elsewhere.com" required />
        </label>
        <button type="submit">Add for confirmation</button>
      </form>
    </section>
  );
}
