import { notFound, redirect } from "next/navigation";
import { NotFoundError } from "@chameleon/db";
import { requirePageSession } from "../../../../server/session";
import {
  getDomainView,
  listChecks,
  listDomainHostnames,
  removeDomain,
  removeHostname,
} from "../../../../server/domains";
import { DnsRecords } from "../../../../components/dns-record";
import { ConfirmSubmit } from "../../../../components/shell";
import {
  Empty,
  PageHeader,
  StatusPill,
  shortDate,
  shortTime,
} from "../../../../components/ui";

const errors: Record<string, string> = {
  hostname_exists: "That hostname is already in use.",
  hostname_tombstoned: "Another account held that hostname recently.",
  hostname_slots_exhausted: "The service is at its hostname limit. Upgrade to add more.",
  domain_not_verified: "Verify the domain before adding hostnames.",
  bad_label: "Use a hostname label such as portal, secure or access.",
};

export default async function DomainDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; added?: string }>;
}) {
  const { id } = await params;
  const session = await requirePageSession();
  let domain;
  try {
    domain = await getDomainView(session, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const [hostnames, checks, flash] = await Promise.all([
    listDomainHostnames(session, id),
    listChecks(session, id),
    searchParams,
  ]);

  async function remove() {
    "use server";
    const ctx = await requirePageSession();
    await removeDomain(ctx, id);
    redirect("/settings/domains?removed=1");
  }

  async function killHostname(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    try {
      await removeHostname(ctx, String(formData.get("hostnameId") ?? ""));
    } catch (error) {
      redirect(
        `/settings/domains/${id}?error=${(error as { code?: string }).code ?? "x"}`,
      );
    }
    redirect(`/settings/domains/${id}`);
  }

  return (
    <main className="app" id="content">
      <PageHeader
        crumbs={[
          { href: "/settings", label: "Configuration" },
          { href: "/settings/domains", label: "Domains" },
        ]}
        title={domain.root}
        lede="One verification, one wildcard record, then hostnames per service. The domain is account-wide; a hostname belongs to one service."
        actions={
          <form action={remove}>
            <ConfirmSubmit
              message={`Remove ${domain.root}? Its hostnames stop answering and the domain is held for 30 days.`}
            >
              Remove domain
            </ConfirmSubmit>
          </form>
        }
      />

      {flash.error ? (
        <p className="error" role="alert">
          {errors[flash.error] ?? "That did not work."}
        </p>
      ) : null}
      {flash.added ? (
        <p className="note info">
          Publish the ownership record, then press Check now. Verification usually takes
          5–30 minutes.
        </p>
      ) : null}

      {domain.reviewNeeded ? (
        <p className="note warn">
          The domain was imported from an older hostname; confirm the root is{" "}
          <code>{domain.root}</code> and not a subdomain.
        </p>
      ) : null}

      <div className="grid2">
        <section className="card">
          <h2>Overview</h2>
          <dl className="kv">
            <dt>Status</dt>
            <dd>
              <StatusPill status={domain.status} />
            </dd>
            <dt>Routing</dt>
            <dd>{domain.routingState === "active" ? "live" : "waiting for routing"}</dd>
            <dt>Hostnames</dt>
            <dd>{domain.hostnameCount}</dd>
          </dl>
          <div className="divider-label" style={{ marginTop: "1rem" }}>
            DNS configuration
          </div>
          <DnsRecords domain={domain} />
        </section>

        <section className="card">
          <h2>Hostnames</h2>
          {hostnames.length === 0 ? (
            <Empty title="No hostnames">
              Create one from a service: open the service, press Create link, and pick
              this domain.
            </Empty>
          ) : (
            <div className="table">
              {hostnames.map((hostname) => (
                <div className="tr" key={hostname.id}>
                  <div>
                    <strong>{hostname.fqdn}</strong>
                    <span className="muted"> · {hostname.serviceName}</span>
                  </div>
                  <StatusPill status={hostname.status} />
                  <div className="actions">
                    <form action={killHostname}>
                      <input type="hidden" name="hostnameId" value={hostname.id} />
                      <ConfirmSubmit message={`Remove ${hostname.fqdn}?`}>
                        Remove
                      </ConfirmSubmit>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="card" style={{ marginTop: "1.1rem" }}>
        <h2>Verification history</h2>
        {checks.length === 0 ? (
          <p className="muted">No checks yet.</p>
        ) : (
          <div className="table">
            {checks.map((check) => (
              <div className="tr" key={check.id}>
                <StatusPill
                  status={check.result === "match" ? "verified" : check.result}
                />
                <span className="muted">{check.detail ?? "—"}</span>
                <span className="fine">{shortTime(check.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
        <p className="fine" style={{ marginTop: "0.7rem" }}>
          Added {shortDate(domain.checkedAt ?? "")}. A failed check restarts the 72-hour
          window rather than killing the row.
        </p>
      </section>
    </main>
  );
}
