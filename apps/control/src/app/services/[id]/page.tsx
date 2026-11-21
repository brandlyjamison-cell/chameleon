import { notFound } from "next/navigation";
import { NotFoundError } from "@chameleon/db";
import { requireSession } from "../../../server/session";
import { getService } from "../../../server/services";

const errors: Record<string, string> = {
  email_unverified: "Verify your email before activating this service.",
  passcode_mismatch: "A passcode is already set with a different value.",
  invalid_input: "Passcode needs 10+ characters with a letter and a digit.",
  owner_only: "Only the owner can activate.",
};

export default async function ServiceDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; activated?: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  let service;
  try {
    service = await getService(session, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { error, activated } = await searchParams;
  const live =
    service.status === "active" &&
    service.expiresAt !== null &&
    new Date(service.expiresAt) > new Date();

  return (
    <>
      <h1>{service.serviceType}</h1>
      <p className="muted">{service.id}</p>
      {error && <p className="error">{errors[error] ?? "That did not work."}</p>}
      {activated && <p className="muted">Activated. The 30-day clock is running.</p>}

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

      {service.activatedAt && (
        <p className="muted">
          Links and domains arrive in the next stage; the vault surface is behind the edge
          worker.
        </p>
      )}
    </>
  );
}
