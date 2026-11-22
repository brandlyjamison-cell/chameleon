import type { DomainView } from "@chameleon/contracts";
import { CopyAll, CopyField } from "./copy";
import { StatusPill, shortTime } from "./ui";

const GUIDANCE: Record<string, string> = {
  pending:
    "Add both records at the DNS provider that hosts this hostname. Nothing is checked until you press “Check now”.",
  verifying:
    "The TXT record has not been seen yet. DNS often takes 5–30 minutes; the platform also retries every few minutes for 72 hours.",
  failed:
    "A live host stopped proving its TXT record. Re-add the record, then check again — the row is re-checkable rather than dead.",
  active:
    "Both records are in place and the certificate is live. Removing the TXT record later will take the host out of service.",
};

/** Human translation of the probe result, not the raw code. */
function explain(domain: DomainView): string | null {
  if (domain.status === "active") return null;
  if (domain.lastResult === "mismatch") {
    return "A TXT record exists at that name but the value does not match. Check for a typo or a second record.";
  }
  if (domain.lastResult === "error") {
    return "The resolver could not be reached. That is usually temporary and not a mistake on your side.";
  }
  if (domain.lastResult === "match") {
    return "The TXT value is proven. Waiting on certificate issuance and the routing record.";
  }
  return null;
}

export function DnsRecords({
  domain,
  serviceId,
  returnTo,
}: {
  domain: DomainView;
  serviceId: string;
  returnTo?: string;
}) {
  const record = [
    `Type: ${domain.recordType}`,
    `Name: ${domain.verifyName}`,
    `Value: ${domain.verifyValue}`,
    `TTL: ${domain.ttl}`,
  ].join("\n");
  const routing = domain.routing
    ? [
        `Type: ${domain.routing.type}`,
        `Name: ${domain.routing.name}`,
        `Value: ${domain.routing.value}`,
        `TTL: ${domain.ttl}`,
      ].join("\n")
    : null;

  return (
    <div className="stack">
      <div className="statusbar">
        <StatusPill status={domain.status} />
        <span className="fine">
          {domain.checkedAt
            ? `Last checked ${shortTime(domain.checkedAt)}`
            : "Not checked yet"}
        </span>
      </div>

      <p className="hint">{GUIDANCE[domain.status] ?? GUIDANCE.pending}</p>
      {explain(domain) ? <p className="note warn">{explain(domain)}</p> : null}

      <div className="copyfield-group">
        <CopyField
          label="Ownership record — type"
          value={domain.recordType}
          hint="A TXT record proves you control the hostname."
        />
        <CopyField label="Host / name" value={domain.verifyName} />
        <CopyField label="Value" value={domain.verifyValue} />
        <CopyField label="TTL" value={String(domain.ttl)} hint="300 seconds is fine." />
        <CopyAll value={record} />
      </div>

      {routing ? (
        <>
          <div className="divider-label">Routing</div>
          <p className="hint">
            The hostname must point at the platform so the edge can answer for it. Add
            this once the ownership record is saved.
          </p>
          <CopyField label="Type" value={routing.split("\n")[0]!.replace("Type: ", "")} />
          <CopyField label="Host / name" value={domain.routing!.name} />
          <CopyField
            label="Target"
            value={domain.routing!.value}
            hint="Use a CNAME at the root only where your provider supports it; otherwise use a subdomain."
          />
          <CopyAll value={routing} />
        </>
      ) : null}

      <div className="actions">
        <form action={`/api/domains/${domain.id}/check`} method="post">
          <input
            type="hidden"
            name="returnTo"
            value={returnTo ?? `/services/${serviceId}#domains`}
          />
          <button type="submit" className="btn sm">
            Check now
          </button>
        </form>
        <a className="btn ghost sm" href={`/services/${serviceId}#domains`}>
          Service
        </a>
      </div>
    </div>
  );
}
