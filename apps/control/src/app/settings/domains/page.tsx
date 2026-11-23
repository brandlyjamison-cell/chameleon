import { redirect } from "next/navigation";
import { requirePageSession } from "../../../server/session";
import { listOrgDomains, removeDomain, requestDomain } from "../../../server/domains";
import { ConfirmSubmit } from "../../../components/shell";
import { Empty, PageHeader, StatusPill, shortDate } from "../../../components/ui";

function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? "not_found";
}

const errors: Record<string, string> = {
  bad_domain: "That is not a domain. Enter a root such as example.com.",
  use_root_domain:
    "Enter the root domain, not a subdomain: example.com, not login.example.com.",
  domain_exists: "That domain is already on the account.",
  domain_tombstoned:
    "Another account held that domain recently. It returns after 30 days.",
  zone_full: "The platform is at its live-domain ceiling. Try again shortly.",
};

export default async function DomainsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; added?: string }>;
}) {
  const session = await requirePageSession();
  const domains = await listOrgDomains(session);
  const params = await searchParams;

  async function add(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    let id: string;
    try {
      id = (await requestDomain(ctx, String(formData.get("root") ?? ""))).id;
    } catch (error) {
      redirect(`/settings/domains?error=${codeOf(error)}`);
    }
    redirect(`/settings/domains/${id}?added=1`);
  }

  async function remove(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    try {
      await removeDomain(ctx, String(formData.get("domainId") ?? ""));
    } catch (error) {
      redirect(`/settings/domains?error=${codeOf(error)}`);
    }
    redirect("/settings/domains?removed=1");
  }

  return (
    <main className="app" id="content">
      <PageHeader
        crumbs={[{ href: "/settings", label: "Configuration" }, { label: "Domains" }]}
        title="Domains"
        lede="Owned by the account, not by one service. Verify a domain once, then create as many hostnames under it as your plans allow."
      />

      {params.error ? (
        <p className="error" role="alert">
          {errors[params.error] ?? "That did not work."}
        </p>
      ) : null}
      {params.added ? (
        <p className="note info">
          Domain added. Publish the ownership record, then check.
        </p>
      ) : null}

      <form action={add} className="card" style={{ marginBottom: "1.1rem" }}>
        <div className="field-row">
          <div className="field grow">
            <label htmlFor="root">Add a domain</label>
            <input
              id="root"
              name="root"
              required
              placeholder="example.com"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="fine">
              The root only. Subdomains such as <code>portal.example.com</code> are
              hostnames and come later.
            </p>
          </div>
          <button type="submit" className="btn">
            Add domain
          </button>
        </div>
      </form>

      {domains.length === 0 ? (
        <Empty title="No domains yet">
          A domain is verified once and then shared by every eligible service on the
          account. Nothing resolves until it is verified.
        </Empty>
      ) : (
        <div className="table">
          {domains.map((domain) => (
            <div className="tr" key={domain.id}>
              <a href={`/settings/domains/${domain.id}`}>
                <strong>{domain.root}</strong>
                {domain.reviewNeeded ? (
                  <span className="muted"> · check the root</span>
                ) : null}
              </a>
              <StatusPill status={domain.status} />
              <span className="muted">
                {domain.hostnameCount} hostname{domain.hostnameCount === 1 ? "" : "s"}
              </span>
              <span className="muted">added {shortDate(domain.checkedAt ?? "")}</span>
              <div className="actions">
                <a className="btn ghost sm" href={`/settings/domains/${domain.id}`}>
                  Open
                </a>
                <form action={remove}>
                  <input type="hidden" name="domainId" value={domain.id} />
                  <ConfirmSubmit
                    className="btn ghost sm"
                    message={`Remove ${domain.root}? Its hostnames stop answering and the domain is held for 30 days.`}
                  >
                    Remove
                  </ConfirmSubmit>
                </form>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
