import { redirect } from "next/navigation";
import { requireAdminPage } from "../../server/session";
import { listAllServices, listOrgs, overview, setStatus } from "../../server/admin";

export default async function Admin() {
  const session = await requireAdminPage();
  const [counts, orgs, services] = await Promise.all([
    overview(session),
    listOrgs(session),
    listAllServices(session),
  ]);

  async function toggle(formData: FormData) {
    "use server";
    const ctx = await requireAdminPage();
    const id = String(formData.get("id") ?? "");
    const next = formData.get("next") === "suspend" ? "suspended" : "active";
    await setStatus(ctx, id, next);
    redirect("/admin");
  }

  return (
    <main className="app wide" id="content">
      <p className="eyebrow">Operator</p>
      <h1>Admin</h1>
      <p className="muted">
        Every tenant, cross-tenant by definition. Read-only on captures: the operator
        stays blind to plaintext.
      </p>

      <div className="tiles">
        <div className="tile">
          <strong>{counts.orgs}</strong>
          <span className="muted">orgs</span>
        </div>
        <div className="tile">
          <strong>{counts.services}</strong>
          <span className="muted">services</span>
        </div>
        <div className="tile">
          <strong>{counts.active}</strong>
          <span className="muted">active</span>
        </div>
        <div className="tile">
          <strong>{counts.unpaid}</strong>
          <span className="muted">unpaid</span>
        </div>
        <div className="tile">
          <strong>{counts.captures}</strong>
          <span className="muted">captures</span>
        </div>
      </div>

      <p>
        <a className="btn" href="/admin/mail">
          Mail queue
        </a>
      </p>

      <h2>Services</h2>
      <div className="table">
        {services.map((service) => (
          <div className="tr" key={service.serviceId}>
            <a href={`/admin/${service.serviceId}`}>
              <strong>{service.orgName}</strong>
              <span className="muted">{service.ownerEmail ?? "no owner"}</span>
            </a>
            <span className="pill">{service.status}</span>
            <span className="muted">{service.tier}</span>
            <span className="muted">
              {service.paidUntil
                ? `paid to ${new Date(service.paidUntil).toLocaleDateString()}`
                : "unpaid"}
            </span>
            <span className="muted">{service.captures} captures</span>
            <form action={toggle}>
              <input type="hidden" name="id" value={service.serviceId} />
              <input
                type="hidden"
                name="next"
                value={service.status === "suspended" ? "restore" : "suspend"}
              />
              <button type="submit" className="link">
                {service.status === "suspended" ? "restore" : "suspend"}
              </button>
            </form>
          </div>
        ))}
        {services.length === 0 && <p className="muted">No services yet.</p>}
      </div>

      <h2>Orgs</h2>
      <div className="table">
        {orgs.map((org) => (
          <div className="tr" key={org.orgId}>
            <strong>{org.orgName}</strong>
            <span className="muted">{org.ownerEmail ?? "no owner"}</span>
            <span className="muted">{org.services} services</span>
            <span className="muted">{org.captures} captures</span>
            <span className="muted">${(org.paid / 100).toFixed(2)} paid</span>
            <span className="muted">{new Date(org.createdAt).toLocaleDateString()}</span>
          </div>
        ))}
        {orgs.length === 0 && <p className="muted">No orgs yet.</p>}
      </div>
    </main>
  );
}
