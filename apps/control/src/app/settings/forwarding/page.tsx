import { redirect } from "next/navigation";
import { requirePageSession } from "../../../server/session";
import { addAddress, listAddresses, MAX_ADDRESSES } from "../../../server/forwards";
import { PageHeader, StatusPill, shortDate } from "../../../components/ui";

export default async function Forwarding() {
  const session = await requirePageSession();
  const addresses = await listAddresses(session);
  const signup = session.email.toLowerCase();
  const hasSignup = addresses.some((address) => address.email.toLowerCase() === signup);

  async function add(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    try {
      await addAddress(ctx, String(formData.get("email") ?? ""));
    } catch (error) {
      redirect(`/settings/forwarding?error=${(error as { code?: string }).code ?? "x"}`);
    }
    redirect("/settings/forwarding?added=1");
  }

  return (
    <main className="app narrow" id="content">
      <PageHeader
        crumbs={[{ href: "/settings", label: "Configuration" }, { label: "Forwarding" }]}
        title="Forwarding"
        lede="Where capture mail goes. Your signup address is already proven; any other address must confirm a 24-hour link first."
      />
      {addresses.some((address) => address.status === "pending") ? (
        <p className="note warn">
          A pending address never receives capture mail until the confirmation link is
          opened.
        </p>
      ) : null}

      <div className="stack">
        {!hasSignup ? (
          <div className="card">
            <div className="row">
              <div>
                <strong>{signup}</strong>
                <div className="fine">
                  Signup address — trusted without a second round trip
                </div>
              </div>
              <StatusPill status="verified" />
            </div>
          </div>
        ) : null}

        {addresses.map((address) => (
          <div className="card" key={address.id}>
            <div className="row">
              <div>
                <strong>{address.email}</strong>
                <div className="fine">Added {shortDate(address.createdAt)}</div>
              </div>
              <StatusPill status={address.status} />
            </div>
            <div className="actions" style={{ marginTop: "0.7rem" }}>
              <form action={`/api/forwards/${address.id}/delete`} method="post">
                <button type="submit" className="btn ghost sm">
                  Remove
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>

      <section className="section">
        <h2>Add an address</h2>
        {addresses.length >= MAX_ADDRESSES ? (
          <p className="muted">Five addresses is the ceiling. Remove one first.</p>
        ) : (
          <form action={add} className="card">
            <div className="field">
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="you@elsewhere.com"
              />
              <p className="fine">
                We mail a confirmation link valid for 24 hours. Until it is opened the
                address is pending.
              </p>
            </div>
            <button type="submit" className="btn">
              Add and send confirmation
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
