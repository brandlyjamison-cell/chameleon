import { requireAdminPage } from "../../../server/session";
import { recentAudit } from "../../../server/admin";
import { PageHeader, shortTime } from "../../../components/ui";

export default async function Audit() {
  const session = await requireAdminPage();
  const rows = await recentAudit(session, 200);

  return (
    <main className="app" id="content">
      <PageHeader
        eyebrow="Platform"
        crumbs={[{ href: "/admin", label: "Operator panel" }, { label: "Audit log" }]}
        title="Audit log"
        lede="Append-only operator actions: status moves, comp days, notes and mail retries."
      />
      {rows.length === 0 ? (
        <p className="muted">Nothing recorded yet.</p>
      ) : (
        <div className="table">
          {rows.map((row) => (
            <div className="tr" key={row.id}>
              <strong className="mono">{row.action}</strong>
              <span className="muted mono">{row.targetId}</span>
              <span className="muted mono">{row.actorId?.slice(0, 8) ?? "system"}</span>
              <span className="fine mono">{JSON.stringify(row.detail ?? {})}</span>
              <span className="muted">{shortTime(row.createdAt)}</span>
              <span />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
