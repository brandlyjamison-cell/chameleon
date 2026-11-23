import type { ReactNode } from "react";
import { requireAdminPage } from "../../server/session";

/** Operator chrome: its own rail, guarded once for every child page. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return (
    <>
      <div className="adminbar">
        <span className="pill idle">Operator</span>
        <a className="navitem" href="/admin">
          Tenants
        </a>
        <a className="navitem" href="/admin/mail">
          Mail queue
        </a>
        <a className="navitem" href="/admin/audit">
          Audit log
        </a>
        <span className="spacer" />
        <a className="navitem" href="/dashboard">
          Back to console
        </a>
      </div>
      {children}
    </>
  );
}
