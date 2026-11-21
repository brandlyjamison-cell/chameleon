import { redirect } from "next/navigation";
import { requirePageSession, requireOwner } from "../../../server/session";
import { PageHeader } from "../../../components/ui";

const errors: Record<string, string> = {
  owner_only: "Only the owner can create a service.",
  invalid_input: "Pick a type and a tier.",
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
        lede="A service is a separate capture surface with its own domains, links and vault slice."
      />
      {error ? <p className="error">{errors[error] ?? "Could not create it."}</p> : null}

      <form action="/api/services" method="post">
        <input type="hidden" name="serviceType" value="chameleon" />

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
              <h2 style={{ marginTop: "0.6rem" }}>{tier.name}</h2>
              <ul className="fine" style={{ paddingLeft: "1.1rem", margin: 0 }}>
                {tier.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </label>
          ))}
        </div>

        <p className="note info" style={{ marginTop: "1rem" }}>
          Chameleon captures credentials only: never an OTP box it cannot fill. Created as{" "}
          <code>provisioning</code>; the paid period and the 30-day clock start at
          activation.
        </p>

        <button type="submit" className="btn">
          Create service
        </button>
      </form>
    </main>
  );
}
