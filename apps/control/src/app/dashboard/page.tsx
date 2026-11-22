import { requirePageSession } from "../../server/session";
import { listServices } from "../../server/services";
import { getOrg } from "../../server/account";
import { countCaptures, listCaptures } from "../../server/vault";
import { troubleDomains } from "../../server/domains";
import { listOrgQueue } from "../../server/mailqueue";
import { Empty, PageHeader, StatusPill, money, shortTime } from "../../components/ui";

export default async function Dashboard() {
  const session = await requirePageSession();
  const [org, services, counts, recent, issues] = await Promise.all([
    getOrg(session),
    listServices(session),
    countCaptures(session),
    listCaptures(session, { limit: 6 }),
    troubleDomains(session),
  ]);
  const mail = await listOrgQueue(session, 5).catch(() => []);
  const failedMail = mail.filter((row) => row.status === "failed");

  const live = services.filter((service) => service.status === "active");
  const unpaid = services.filter(
    (service) =>
      !service.paidUntil || new Date(service.paidUntil).getTime() <= Date.now(),
  );

  return (
    <main className="app" id="content">
      <PageHeader
        eyebrow={org.name}
        title={session.emailVerified ? "Welcome back" : "Welcome"}
        lede="The state of your services, captures and anything that needs attention."
        actions={
          <>
            <a className="btn" href="/services/new">
              New service
            </a>
            <a className="btn ghost" href="/vault">
              Open vault
            </a>
          </>
        }
      />

      {!session.emailVerified ? (
        <p className="note warn">
          Confirm <strong>{session.email}</strong> before activating a service.{" "}
          <a href="/welcome">Resend the link</a>.
        </p>
      ) : null}

      {services.length === 0 ? (
        <Empty
          title="No services yet"
          action={
            <a className="btn" href="/services/new">
              Create your first service
            </a>
          }
        >
          A service is one capture surface: its own links, domains, vault slice and
          billing. Nothing is charged until you activate one.
        </Empty>
      ) : (
        <div className="stack">
          {unpaid.length > 0 ? (
            <p className="note warn">
              {unpaid.length === 1 ? "One service has" : `${unpaid.length} services have`}{" "}
              no paid period. Links stop rendering once a period lapses.{" "}
              <a href="/services">Review billing</a>
            </p>
          ) : null}

          {issues.length > 0 ? (
            <p className="note warn">
              {issues.length === 1 ? "One domain needs" : `${issues.length} domains need`}{" "}
              a DNS fix. <a href="/settings/domains">Open the record details</a>
            </p>
          ) : null}

          {failedMail.length > 0 ? (
            <p className="note warn">
              {failedMail.length === 1 ? "One message" : `${failedMail.length} messages`}{" "}
              failed to deliver. <a href="/settings/delivery">See delivery status</a>
            </p>
          ) : null}

          <div className="tiles">
            <div className="tile">
              <strong>{live.length}</strong>
              <span className="muted">live services</span>
            </div>
            <div className="tile">
              <strong>{counts.new}</strong>
              <span className="muted">new captures</span>
            </div>
            <div className="tile">
              <strong>{counts.valid}</strong>
              <span className="muted">marked valid</span>
            </div>
            <div className="tile">
              <strong>{counts.total}</strong>
              <span className="muted">stored captures</span>
            </div>
          </div>

          <div className="split">
            <section>
              <h2>Services</h2>
              <div className="table">
                {services.map((service) => (
                  <div className="tr" key={service.id}>
                    <a href={`/services/${service.id}`}>
                      <strong>{service.serviceType}</strong>
                      <span className="muted"> {service.tier} tier</span>
                    </a>
                    <StatusPill status={service.status} />
                    <span className="muted">{money(service.priceCents)} / 30d</span>
                    <span className="muted">
                      {service.paidUntil
                        ? `paid to ${shortTime(service.paidUntil)}`
                        : "payment due"}
                    </span>
                    <span className="muted">
                      {service.activatedAt ? "activated" : "not activated"}
                    </span>
                    <a className="btn ghost sm" href={`/services/${service.id}`}>
                      Manage
                    </a>
                  </div>
                ))}
              </div>
            </section>

            <aside>
              <div className="card">
                <h2>Latest captures</h2>
                {recent.length === 0 ? (
                  <p className="muted">
                    Nothing captured yet. A capture appears here as soon as a visitor
                    submits a link.
                  </p>
                ) : (
                  <div className="stack">
                    {recent.map((capture) => (
                      <div key={capture.id}>
                        <strong className="mono">
                          {String(capture.fields.username ?? "unknown")}
                        </strong>
                        <div className="fine">
                          {capture.serviceType} · {shortTime(capture.receivedAt)} ·{" "}
                          {capture.source}
                        </div>
                      </div>
                    ))}
                    <a className="btn ghost sm" href="/vault">
                      All captures
                    </a>
                  </div>
                )}
              </div>

              <div className="card">
                <h2>Mail</h2>
                <p className="fine">
                  {mail.length === 0
                    ? "No mail queued for this org yet."
                    : `Queued ${mail.filter((row) => row.status === "queued").length}, failed ${failedMail.length} in the latest ${mail.length}.`}
                </p>
                <a className="btn ghost sm" href="/settings/delivery">
                  Delivery status
                </a>
              </div>
            </aside>
          </div>
        </div>
      )}
    </main>
  );
}
