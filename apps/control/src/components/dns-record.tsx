import type { OrgDomainView } from "@chameleon/contracts";
import { CopyAll, CopyField } from "./copy";
import { StatusPill, shortTime } from "./ui";

const GUIDANCE: Record<string, string> = {
  pending:
    "Add the ownership record at the DNS provider that hosts this domain, then press “Check now”.",
  verifying:
    "The TXT record has not been seen yet. DNS often takes 5–30 minutes; the platform retries every few minutes for 72 hours.",
  routing_waiting:
    "Ownership is proven. Add the wildcard routing record so every hostname under this domain can answer, then check again once routing is enabled.",
  failed:
    "The TXT record stopped proving ownership. Re-add it and check again — the row is re-checkable rather than dead.",
  active:
    "Ownership and routing are both proven. Every hostname you create under this domain gets its certificate automatically.",
};

/** Human translation of the probe result, not the raw code. */
function explain(domain: OrgDomainView): string | null {
  if (domain.status === "active") return null;
  if (domain.lastResult === "mismatch") {
    return "A TXT record exists at that name but the value does not match. Check for a typo or a second record.";
  }
  if (domain.lastResult === "error") {
    return "The resolver could not be reached. That is usually temporary and not a mistake on your side.";
  }
  if (domain.lastResult === "match" && domain.status !== "routing_waiting") {
    return "The TXT value is proven. Waiting on certificate issuance and the routing record.";
  }
  return null;
}

export function DnsRecords({ domain }: { domain: OrgDomainView }) {
  const record = [
    `Type: ${domain.recordType}`,
    `Name: ${domain.verifyName}`,
    `Value: ${domain.verifyValue}`,
    `TTL: ${domain.ttl}`,
  ].join("\n");
  // The wildcard is the one-time routing setup; the tenant never repeats it.
  const routingRecords = domain.routing
    ? [
        `Type: ${domain.routing.type}`,
        `Name: ${domain.routing.name}`,
        `Value: ${domain.routing.value}`,
        `TTL: ${domain.ttl}`,
      ].join("\n")
    : "";

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
          hint="One TXT record proves you control the whole domain."
        />
        <CopyField label="Host / name" value={domain.verifyName} />
        <CopyField label="Value" value={domain.verifyValue} />
        <CopyField label="TTL" value={String(domain.ttl)} hint="300 seconds is fine." />
        <CopyAll value={record} />
      </div>

      <div className="divider-label">Routing — set once</div>
      <p className="hint">
        One wildcard record routes every hostname you create later. You will not repeat
        this per hostname.
      </p>
      {domain.routing ? (
        <>
          <CopyField label="Type" value={domain.routing.type} />
          <CopyField label="Host / name" value={domain.routing.name} />
          <CopyField
            label="Target"
            value={domain.routing.value}
            hint="A wildcard CNAME is safe to add before routing is enabled."
          />
          <CopyAll value={routingRecords} />
        </>
      ) : (
        <p className="fine">
          Wildcard target{" "}
          <code>
            *.{domain.root} → {domain.target}
          </code>
        </p>
      )}

      <div className="actions">
        <form action={`/api/domains/${domain.id}/check`} method="post">
          <input type="hidden" name="returnTo" value={`/settings/domains/${domain.id}`} />
          <button type="submit" className="btn sm">
            Check now
          </button>
        </form>
      </div>
    </div>
  );
}
