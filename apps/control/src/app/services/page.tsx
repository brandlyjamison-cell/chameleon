import { redirect } from "next/navigation";
import { requireSession } from "../../server/session";
import { listServices } from "../../server/services";

export default async function Services() {
  const session = await requireSession();
  if (!session.orgId) redirect("/welcome");
  const services = await listServices(session);

  return (
    <>
      <h1>Services</h1>
      <p className="muted">
        Each service is one capture surface: its own links, domains and vault.
      </p>
      {services.length === 0 && <p>Nothing here yet.</p>}
      {services.map((service) => (
        <a
          key={service.id}
          href={`/services/${service.id}`}
          className="card"
          style={{ display: "block", textDecoration: "none", color: "inherit" }}
        >
          <div className="row">
            <strong>{service.serviceType}</strong>
            <span className="pill">{service.status}</span>
          </div>
          <div className="row muted">
            <span>{service.tier} tier</span>
            <span>{service.activatedAt ? "activated" : "not activated"}</span>
          </div>
        </a>
      ))}
      <p>
        <a href="/services/new">Create a service</a>
      </p>
    </>
  );
}
