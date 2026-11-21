import { notFound, redirect } from "next/navigation";
import { NotFoundError } from "@chameleon/db";
import { requirePageSession } from "../../../server/session";
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
  invalid_input: "Passcode needs 10+ characters with a letter and a digit.",
  owner_only: "Only the org owner can do that.",
  bad_hostname: "That is not a hostname (no scheme, no path).",
  domain_exists: "That hostname is already attached here.",
  domain_tombstoned: "Another org used that hostname in the last 30 days.",
  cap: "No domain slots left on this tier.",
  zone_full: "The platform is at its live-domain ceiling.",
  not_found: "That domain is gone.",
};

function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? "not_found";
}

export default async function ServiceDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; activated?: string; domain_added?: string }>;
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
  const { error, activated, domain_added } = await searchParams;
  const live =
    service.status === "active" &&
    service.expiresAt !== null &&
    new Date(service.expiresAt) > new Date();

  return (
    <main className="app" id="content">
      <h1>{service.serviceType}</h1>
      <p className="muted">{service.id}</p>
      {error && <p className="error">{errors[error] ?? "That did not work."}</p>}
      {activated && <p className="muted">Activated. The 30-day clock is running.</p>}
      {domain_added && (
        <p className="muted">Hostname added. Publish the TXT record, then check.</p>
      )}

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
          <span>{service.tier}</span>
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

      {!service.activatedAt && (
        <>
          <h2>Activate</h2>
          <p className="muted">
            The passcode wraps the service key. Without it the vault cannot be opened —
            including by us.
          </p>
          <form action={`/api/services/${service.id}/activate`} method="post">
            <label>
              Vault passcode
              <input
                name="passcode"
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={128}
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

      {service.activatedAt && <Domains id={service.id} session={session} />}
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
