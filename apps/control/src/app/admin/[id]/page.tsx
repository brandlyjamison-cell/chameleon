import { notFound, redirect } from "next/navigation";
import { requireAdminPage } from "../../../server/session";
import {
  extendDays,
  recentAudit,
  serviceDetail,
  setNote,
  setStatus,
} from "../../../server/admin";
import { PageHeader, StatusPill, shortTime } from "../../../components/ui";

export default async function AdminService({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireAdminPage();
  const service = await serviceDetail(session, id);
  if (!service) notFound();
  const audit = await recentAudit(session, 100);
  const mine = audit.filter((row) => row.targetId === id);

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
      <PageHeader
        eyebrow="Platform"
        crumbs={[
          { href: "/admin", label: "Tenants" },
          { href: `/admin/tenants/${service.orgId}`, label: service.orgName },
          { label: "Service" },
        ]}
        title={`${service.tier} service`}
        lede={`Service ${service.serviceId}`}
        actions={
          <>
            <StatusPill status={service.status} />
            <a className="btn ghost sm" href={`/services/${service.serviceId}`}>
              Tenant view
            </a>
          </>
        }
      />

      <div className="split">
        <div>
          <div className="card">
            <h2>Facts</h2>
            <dl className="kv">
              <dt>Owner</dt>
              <dd>{service.ownerEmail ?? "none"}</dd>
              <dt>Tier</dt>
              <dd>{service.tier}</dd>
              <dt>Paid through</dt>
              <dd>{service.paidUntil ? shortTime(service.paidUntil) : "unpaid"}</dd>
              <dt>Activation clock</dt>
              <dd>{service.expiresAt ? shortTime(service.expiresAt) : "—"}</dd>
              <dt>Captures</dt>
              <dd>{service.captures}</dd>
            </dl>
          </div>

          <div className="card">
            <h2>Comp time</h2>
            <form action={extend} className="inline-form">
              <div className="field">
                <label htmlFor="days">Days to add</label>
                <input
                  id="days"
                  name="days"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={30}
                />
              </div>
              <button type="submit" className="btn">
                Extend paid period
              </button>
            </form>
            <p className="fine">
              Comp is written to the payment ledger as an operator action and is audited.
            </p>
          </div>

          <div className="card">
            <h2>Status</h2>
            <div className="actions">
              {(["active", "suspended", "archived", "provisioning"] as const).map(
                (value) => (
                  <form action={status} key={value}>
                    <input type="hidden" name="status" value={value} />
                    <button type="submit" className="btn ghost sm">
                      {value}
                    </button>
                  </form>
                ),
              )}
            </div>
          </div>

          <div className="card">
            <h2>Note</h2>
            <form action={note}>
              <textarea name="note" rows={3} defaultValue={service.adminNote ?? ""} />
              <button type="submit" className="btn" style={{ marginTop: "0.6rem" }}>
                Save note
              </button>
            </form>
          </div>

          <div className="card">
            <h2>Payments</h2>
            <div className="table">
              {service.payments.map((payment) => (
                <div className="tr" key={payment.id}>
                  <StatusPill status={payment.status} />
                  <span>${(payment.price / 100).toFixed(2)}</span>
                  <span className="mono muted">{payment.provider ?? "—"}</span>
                  <span className="muted">{shortTime(payment.created)}</span>
                  <span className="muted">to {shortTime(payment.periodEnd)}</span>
                  <span />
                </div>
              ))}
              {service.payments.length === 0 && <p className="muted">No payments yet.</p>}
            </div>
          </div>
        </div>

        <aside className="card">
          <h2>Audit for this service</h2>
          {mine.length === 0 ? (
            <p className="muted">No operator action recorded yet.</p>
          ) : (
            <div className="stack">
              {mine.map((row) => (
                <div key={row.id}>
                  <strong className="mono">{row.action}</strong>
                  <div className="fine">{shortTime(row.createdAt)}</div>
                  {row.detail ? (
                    <div className="fine mono">{JSON.stringify(row.detail)}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
