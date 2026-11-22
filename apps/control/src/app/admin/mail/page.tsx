import { redirect } from "next/navigation";
import { requireAdminPage } from "../../../server/session";
import { mailQueue, retryQueued } from "../../../server/admin";
import { PageHeader, StatusPill, shortTime } from "../../../components/ui";

export default async function AdminMail() {
  const session = await requireAdminPage();
  const rows = await mailQueue(session);

  async function retry(formData: FormData) {
    "use server";
    const ctx = await requireAdminPage();
    await retryQueued(ctx, String(formData.get("id") ?? ""));
    redirect("/admin/mail");
  }

  return (
    <main className="app wide" id="content">
      <PageHeader
        eyebrow="Platform"
        crumbs={[{ href: "/admin", label: "Operator panel" }, { label: "Mail queue" }]}
        title="Mail queue"
        lede="Newest 100 rows. A throttled row is parked for 15 minutes and does not spend a try; a failed row needs a human."
      />

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
