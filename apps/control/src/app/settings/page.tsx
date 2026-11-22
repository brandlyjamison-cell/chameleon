import { requirePageSession } from "../../server/session";
import { getOrg, updateOrg } from "../../server/account";
import { listServices } from "../../server/services";
import { PageHeader, shortDate } from "../../components/ui";

export default async function Settings() {
  const session = await requirePageSession();
  const [org, services] = await Promise.all([getOrg(session), listServices(session)]);

  async function save(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    const { redirect } = await import("next/navigation");
    try {
      await updateOrg(ctx, {
        name: String(formData.get("name") ?? ""),
        notifyOnCapture: formData.get("notifyOnCapture") === "on",
        maskPasswords: formData.get("maskPasswords") === "on",
      });
    } catch {
      redirect("/settings?error=1");
    }
    redirect("/settings?saved=1");
  }

  return (
    <main className="app narrow" id="content">
      <PageHeader
        crumbs={[{ label: "Configuration" }, { label: "Organisation" }]}
        title="Organisation"
        lede="The tenant-wide settings. Service behaviour, domains and credentials live under their own surfaces."
      />

      {session.role !== "owner" ? (
        <p className="note">You are a member; this page is read-only for you.</p>
      ) : null}

      <form action={save} className="card">
        <h2>Profile</h2>
        <div className="field">
          <label htmlFor="name">Organisation name</label>
          <input
            id="name"
            name="name"
            defaultValue={org.name}
            required
            minLength={2}
            maxLength={80}
          />
          <p className="fine">Shown in the console header. The URL slug is fixed.</p>
        </div>
        <dl className="kv" style={{ marginBottom: "1rem" }}>
          <dt>Slug</dt>
          <dd className="mono">{org.slug}</dd>
          <dt>Created</dt>
          <dd>{shortDate(org.createdAt)}</dd>
          <dt>Services</dt>
          <dd>{services.length}</dd>
        </dl>

        <h2>Vault preferences</h2>
        <div className="stack" style={{ marginBottom: "1rem" }}>
          <label className="check">
            <input
              type="checkbox"
              name="notifyOnCapture"
              defaultChecked={org.settings.notifyOnCapture}
            />
            <span>
              <strong>Allow capture mail</strong>
              <span className="fine">
                {" "}
                Eligible captures can be mailed to verified addresses, and the edge ingest
                reads this later. Off keeps the vault quiet.
              </span>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              name="maskPasswords"
              defaultChecked={org.settings.maskPasswords}
            />
            <span>
              <strong>Mask passwords in the vault list</strong>
              <span className="fine">
                {" "}
                The value is still copyable; it is only hidden at rest on screen.
              </span>
            </span>
          </label>
        </div>

        <button type="submit" className="btn" disabled={session.role !== "owner"}>
          Save changes
        </button>
        {org.settings.notifyOnCapture ? null : (
          <p className="fine" style={{ marginTop: "0.7rem" }}>
            Capture mail is currently off. Forwarding addresses can still be mailed by
            hand from the vault.
          </p>
        )}
      </form>

      <div className="card">
        <h2>Where things live</h2>
        <dl className="kv">
          <dt>Domains</dt>
          <dd>
            <a href="/settings/domains">All hostnames and their records</a>
          </dd>
          <dt>Forwarding</dt>
          <dd>
            <a href="/settings/forwarding">Verified destinations for capture mail</a>
          </dd>
          <dt>Delivery</dt>
          <dd>
            <a href="/settings/delivery">Queue and failure state</a>
          </dd>
          <dt>Account</dt>
          <dd>
            <a href="/account">Email, passcode and session</a>
          </dd>
        </dl>
      </div>
    </main>
  );
}
