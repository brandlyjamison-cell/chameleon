import { redirect } from "next/navigation";
import { requirePageSession, requireOwner } from "../../../server/session";
import { PageHeader } from "../../../components/ui";

const errors: Record<string, string> = {
  owner_only: "Only the owner can create a service.",
  invalid_input: "Pick a type, a plan and a name.",
  name_taken: "You already have a service with that name.",
};

const tiers = [
  {
    id: "starter",
    name: "Starter",
    price: "$19 / 30 days",
    points: ["5 live links", "2 hostnames", "50,000 captures"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$49 / 30 days",
    points: ["20 live links", "5 hostnames", "250,000 captures"],
  },
];

export default async function NewService({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requirePageSession();
  if (!session.orgId) redirect("/welcome");
  const { error } = await searchParams;

  try {
    requireOwner(session);
  } catch {
    return (
      <main className="app" id="content">
        <h1>New service</h1>
        <p className="error">Only the owner can create a service.</p>
      </main>
    );
  }

  return (
    <main className="app" id="content">
      <PageHeader
        crumbs={[{ href: "/services", label: "Products & services" }, { label: "New" }]}
        title="New service"
        lede="A service is a separate capture surface with its own hostnames, links and vault slice. The name is yours; the type and plan are the product."
      />
      {error ? <p className="error">{errors[error] ?? "Could not create it."}</p> : null}

      <form action="/api/services" method="post">
        <h2>Product</h2>
        <div className="bento" style={{ marginBottom: "1.2rem" }}>
          <label className="card" style={{ cursor: "pointer" }}>
            <div className="row">
              <input
                type="radio"
                name="serviceType"
                value="chameleon"
                defaultChecked
                required
              />
              <span className="pill ok">Available</span>
            </div>
            <h3 style={{ marginTop: "0.6rem" }}>Chameleon</h3>
            <p className="fine">
              A rotating login page that captures credentials and redirects to the real
              site. One free preview link is provisioned with every service.
            </p>
          </label>
          <label className="card" style={{ opacity: 0.6, cursor: "not-allowed" }}>
            <div className="row">
              <input type="radio" name="serviceType" value="aitm" disabled />
              <span className="pill warn">Coming soon</span>
            </div>
            <h3 style={{ marginTop: "0.6rem" }}>Cookie Link</h3>
            <p className="fine">
              Proxies the real page and keeps the session, including two-step logins.
              Visible now, not purchasable yet.
            </p>
          </label>
        </div>

        <h2>Name</h2>
        <div className="field" style={{ maxWidth: "28rem", marginBottom: "1.1rem" }}>
          <label htmlFor="name">Service name</label>
          <input
            id="name"
            name="name"
            required
            minLength={2}
            maxLength={60}
            placeholder="Marketing Campaign"
          />
          <p className="fine">
            Shown in Overview, Services and the Vault so two Chameleon services are never
            ambiguous.
          </p>
        </div>

        <h2>Plan</h2>
        <div className="bento">
          {tiers.map((tier) => (
            <label className="card" key={tier.id} style={{ cursor: "pointer" }}>
              <div className="row">
                <input
                  type="radio"
                  name="tier"
                  value={tier.id}
                  defaultChecked={tier.id === "starter"}
                />
                <span className="pill idle">{tier.price}</span>
              </div>
              <h3 style={{ marginTop: "0.6rem" }}>{tier.name}</h3>
              <ul className="fine" style={{ paddingLeft: "1.1rem", margin: 0 }}>
                {tier.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </label>
          ))}
        </div>

        <p className="note info" style={{ marginTop: "1rem" }}>
          Chameleon captures credentials only: never an OTP box it cannot fill. The
          preview link works immediately; custom hostnames need a verified domain and a
          paid period.
        </p>

        <button type="submit" className="btn" style={{ marginTop: "0.8rem" }}>
          Create service
        </button>
      </form>
    </main>
  );
}
