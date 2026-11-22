import type { ReactNode } from "react";

const STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: "Active", tone: "ok" },
  provisioning: { label: "Provisioning", tone: "idle" },
  past_due: { label: "Payment due", tone: "warn" },
  expired: { label: "Expired", tone: "bad" },
  suspended: { label: "Suspended", tone: "bad" },
  archived: { label: "Archived", tone: "idle" },
  pending: { label: "Awaiting DNS", tone: "warn" },
  unverified_email: { label: "Awaiting confirmation", tone: "warn" },
  routing_waiting: { label: "Routing pending", tone: "warn" },
  match: { label: "Match", tone: "ok" },
  mismatch: { label: "Mismatch", tone: "warn" },
  error: { label: "Resolver error", tone: "warn" },
  verifying: { label: "Verifying", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
  paused: { label: "Paused", tone: "idle" },
  paid: { label: "Paid", tone: "ok" },
  confirming: { label: "Confirming", tone: "warn" },
  confirmed: { label: "Confirmed", tone: "ok" },
  finished: { label: "Finished", tone: "ok" },
  refunded: { label: "Refunded", tone: "bad" },
  sent: { label: "Sent", tone: "ok" },
  queued: { label: "Queued", tone: "idle" },
  sending: { label: "Sending", tone: "warn" },
  new: { label: "New", tone: "idle" },
  valid: { label: "Valid", tone: "ok" },
  invalid: { label: "Invalid", tone: "bad" },
  verified: { label: "Verified", tone: "ok" },
};

/** Status is data, so the tone map lives in one place. */
export function StatusPill({ status }: { status: string }) {
  const known = STATUS[status] ?? { label: status.replace(/_/g, " "), tone: "idle" };
  return <span className={`pill ${known.tone}`}>{known.label}</span>;
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
  crumbs,
}: {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
  crumbs?: Array<{ href?: string; label: string }>;
}) {
  return (
    <>
      {crumbs && crumbs.length > 0 ? (
        <ol className="breadcrumb">
          {crumbs.map((crumb, index) => (
            <li key={`${crumb.label}-${index}`}>
              {crumb.href ? <a href={crumb.href}>{crumb.label}</a> : crumb.label}
            </li>
          ))}
        </ol>
      ) : null}
      <div className="hero-band">
        <div>
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1>{title}</h1>
          {lede ? <p className="lede">{lede}</p> : null}
        </div>
        {actions ? <div className="actions">{actions}</div> : null}
      </div>
    </>
  );
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function shortDate(value: string | Date | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function shortTime(value: string | Date | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
