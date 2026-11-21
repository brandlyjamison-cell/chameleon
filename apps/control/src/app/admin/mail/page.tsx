import { redirect } from "next/navigation";
import { requireAdminPage } from "../../../server/session";
import { mailQueue, retryQueued } from "../../../server/admin";

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
      <p className="eyebrow">
        <a href="/admin">admin</a> / mail
      </p>
      <h1>Mail queue</h1>
      <p className="muted">
        Newest 100. A `throttled` row is parked 15 minutes and does not spend its six
        tries; `failed` needs a human or a provider that works.
      </p>

      <div className="table">
        {rows.map((row) => (
          <div className="tr" key={row.id}>
            <div>
              <strong>{row.to_address}</strong>
              <span className="muted">{row.subject}</span>
            </div>
            <span className="pill">{row.status}</span>
            <span className="muted">{row.kind}</span>
            <span className="muted">{row.attempts} tries</span>
            <span className="muted">{row.last_error ?? "—"}</span>
            <form action={retry}>
              <input type="hidden" name="id" value={row.id} />
              <button type="submit" className="link">
                retry
              </button>
            </form>
          </div>
        ))}
        {rows.length === 0 && <p className="muted">Nothing queued.</p>}
      </div>
    </main>
  );
}
