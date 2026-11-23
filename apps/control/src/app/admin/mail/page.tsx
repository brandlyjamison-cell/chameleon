import { redirect } from "next/navigation";
import { requireAdminPage } from "../../../server/session";
import { mailQueue, retryQueued } from "../../../server/admin";
import { mailLimits } from "../../../server/mail";
import { mailStats, quotaSpent } from "../../../server/mailqueue";
import { PageHeader, StatusPill, shortTime } from "../../../components/ui";

export default async function AdminMail() {
  const session = await requireAdminPage();
  const [rows, quota, stats] = await Promise.all([
    mailQueue(session),
    mailLimits(),
    mailStats(),
  ]);
  const parked = quotaSpent(quota);

  async function retry(formData: FormData) {
    "use server";
    const ctx = await requireAdminPage();
    await retryQueued(ctx, String(formData.get("id") ?? ""));
    redirect("/admin/mail");
  }

  async function drainNow() {
    "use server";
    await requireAdminPage();
    const { drain } = await import("../../../server/mailqueue");
    await drain(50, true);
    redirect("/admin/mail?drained=1");
  }

  return (
    <main className="app wide" id="content">
      <PageHeader
        eyebrow="Platform"
        crumbs={[{ href: "/admin", label: "Operator panel" }, { label: "Mail queue" }]}
        title="Mail queue"
        lede="Newest 100 rows. A throttled row is parked for 15 minutes and does not spend a try; a failed row needs a human."
        actions={
          <form action={drainNow}>
            <button type="submit" className="btn ghost">
              Drain now
            </button>
          </form>
        }
      />

      <div className="tiles" style={{ marginBottom: "1.1rem" }}>
        <div className="tile">
          <strong>{stats.queued}</strong>
          <span className="muted">queued</span>
        </div>
        <div className="tile">
          <strong>{stats.failed24h}</strong>
          <span className="muted">failed 24h</span>
        </div>
        <div className="tile">
          <strong>{quota ? `${quota.sent} / ${quota.quota}` : "—"}</strong>
          <span className="muted">provider quota today</span>
        </div>
      </div>

      {parked ? (
        <p className="note warn">
          The provider&apos;s daily quota is spent
          {quota?.resetsAt ? ` and resets ${shortTime(quota.resetsAt)}` : ""}. Sending is
          parked; nothing is lost. &quot;Drain now&quot; spends one attempt against the
          provider anyway.
        </p>
      ) : null}

      <div className="table">
        {rows.map((row) => (
          <div className="tr" key={row.id}>
            <div>
              <strong>{row.to_address}</strong>
              <span className="muted"> {row.subject}</span>
            </div>
            <StatusPill status={row.status} />
            <span className="muted">{row.kind}</span>
            <span className="muted">{row.attempts} tries</span>
            <span className="muted">{row.last_error ?? "—"}</span>
            <div className="actions">
              <span className="fine">{shortTime(row.created_at)}</span>
              <form action={retry}>
                <input type="hidden" name="id" value={row.id} />
                <button type="submit" className="btn ghost sm">
                  Retry
                </button>
              </form>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="muted">Nothing queued.</p>}
      </div>
    </main>
  );
}
