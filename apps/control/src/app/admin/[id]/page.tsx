import { notFound, redirect } from "next/navigation";
import { requireAdminPage } from "../../../server/session";
import { extendDays, serviceDetail, setNote, setStatus } from "../../../server/admin";

export default async function AdminService({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireAdminPage();
  const service = await serviceDetail(session, id);
  if (!service) notFound();

  async function extend(formData: FormData) {
    "use server";
    const ctx = await requireAdminPage();
    const days = Number(formData.get("days") ?? 30);
    await extendDays(ctx, id, Number.isFinite(days) && days > 0 ? days : 30);
    redirect(`/admin/${id}`);
  }

  async function status(formData: FormData) {
    "use server";
    const ctx = await requireAdminPage();
    await setStatus(ctx, id, String(formData.get("status") ?? "active"));
    redirect(`/admin/${id}`);
  }

  async function note(formData: FormData) {
    "use server";
    const ctx = await requireAdminPage();
    await setNote(ctx, id, String(formData.get("note") ?? ""));
    redirect(`/admin/${id}`);
  }

  return (
    <main className="app" id="content">
      <p className="eyebrow">
        <a href="/admin">admin</a> / service
      </p>
      <h1>{service.orgName}</h1>
      <p className="muted">{service.serviceId}</p>

      <div className="card">
        <div className="row">
          <span>owner</span>
          <span>{service.ownerEmail ?? "none"}</span>
        </div>
        <div className="row">
          <span>status</span>
          <strong>{service.status}</strong>
        </div>
        <div className="row">
          <span>tier</span>
          <span>{service.tier}</span>
        </div>
        <div className="row">
          <span>paid through</span>
          <span>
            {service.paidUntil ? new Date(service.paidUntil).toLocaleString() : "unpaid"}
          </span>
        </div>
        <div className="row">
          <span>expires</span>
          <span>
            {service.expiresAt ? new Date(service.expiresAt).toLocaleString() : "—"}
          </span>
        </div>
        <div className="row">
          <span>captures</span>
          <span>{service.captures}</span>
        </div>
      </div>

      <h2>Comp time</h2>
      <form action={extend}>
        <label>
          Days to add
          <input name="days" type="number" min={1} max={365} defaultValue={30} />
        </label>
        <button type="submit">Extend paid period</button>
      </form>

      <h2>Status</h2>
      <div className="actions">
        {(["active", "suspended", "archived", "provisioning"] as const).map((value) => (
          <form action={status} key={value}>
            <input type="hidden" name="status" value={value} />
            <button type="submit" className="ghost">
              {value}
            </button>
          </form>
        ))}
      </div>

      <h2>Note</h2>
      <form action={note}>
        <textarea name="note" rows={3} defaultValue={service.adminNote ?? ""} />
        <button type="submit">Save note</button>
      </form>

      <h2>Payments</h2>
      <div className="table">
        {service.payments.map((payment) => (
          <div className="tr" key={payment.id}>
            <span>{payment.status}</span>
            <span>${(payment.price / 100).toFixed(2)}</span>
            <span className="mono muted">{payment.provider ?? "—"}</span>
            <span className="muted">{new Date(payment.created).toLocaleString()}</span>
            <span className="muted">
              to {new Date(payment.periodEnd).toLocaleDateString()}
            </span>
          </div>
        ))}
        {service.payments.length === 0 && <p className="muted">No payments yet.</p>}
      </div>
    </main>
  );
}
