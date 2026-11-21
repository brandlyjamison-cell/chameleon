import { requirePageSession } from "../../../server/session";
import { listOrgQueue, mailStats } from "../../../server/mailqueue";
import { getOrg } from "../../../server/account";
import { PageHeader, StatusPill, shortTime } from "../../../components/ui";

export default async function Delivery() {
  const session = await requirePageSession();
  const [rows, org] = await Promise.all([listOrgQueue(session, 40), getOrg(session)]);
  const stats = await mailStats().catch(() => null);
  const failed = rows.filter((row) => row.status === "failed");
  const queued = rows.filter(
    (row) => row.status === "queued" || row.status === "sending",
  );

  return (
    <main className="app narrow" id="content">
      <PageHeader
        crumbs={[{ href: "/settings", label: "Configuration" }, { label: "Delivery" }]}
        title="Mail delivery"
        lede="Verification, receipts and forwarded captures all pass through one queue. This is the tenant view of it."
      />
      {!org.settings.notifyOnCapture ? (
        <p className="note">
          Capture notification is off in Configuration, so only verification and receipts
          are expected here.
        </p>
      ) : null}
      {stats && stats.oldestQueuedSeconds > 300 ? (
        <p className="note warn">
          The platform backlog is older than five minutes. Delivery may be slow; nothing
          is lost, the queue retries.
        </p>
      ) : null}

      <div className="tiles" style={{ marginBottom: "1.1rem" }}>
        <div className="tile">
          <strong>{queued.length}</strong>
          <span className="muted">waiting in view</span>
        </div>
        <div className="tile">
          <strong>{failed.length}</strong>
          <span className="muted">failed in view</span>
        </div>
        <div className="tile">
          <strong>{rows.filter((row) => row.status === "sent").length}</strong>
          <span className="muted">sent in view</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="muted">No mail has been queued for this org yet.</p>
      ) : (
        <div className="table">
          {rows.map((row) => (
            <div className="tr" key={row.id}>
              <span>
                <strong>{row.kind}</strong>
                <span className="fine"> → {row.to_address}</span>
              </span>
              <StatusPill status={row.status} />
              <span className="muted">{row.attempts} tries</span>
              <span className="muted">{shortTime(row.created_at)}</span>
              <span className="muted">{row.sent_at ? shortTime(row.sent_at) : "—"}</span>
              <span className="fine">{row.last_error ?? ""}</span>
            </div>
          ))}
        </div>
      )}

      <p className="fine" style={{ marginTop: "0.8rem" }}>
        Failed rows are retried by the operator from the admin queue. Throttled rows park
        for 15 minutes without spending a try.
      </p>
    </main>
  );
}
