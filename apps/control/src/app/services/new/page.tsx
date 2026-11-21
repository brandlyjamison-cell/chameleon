import { redirect } from "next/navigation";
import { requirePageSession, requireOwner } from "../../../server/session";

const errors: Record<string, string> = {
  owner_only: "Only the owner can create a service.",
  invalid_input: "Pick a type and a tier.",
};

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
    return <p className="error">Only the owner can create a service.</p>;
  }

  return (
    <main className="app" id="content">
      <h1>New service</h1>
      {error && <p className="error">{errors[error] ?? "Could not create it."}</p>}
      <form action="/api/services" method="post">
        <label>
          Type
          <select name="serviceType">
            <option value="chameleon">chameleon — credential only, no OTP field</option>
          </select>
        </label>
        <label>
          Tier
          <select name="tier" defaultValue="starter">
            <option value="starter">starter — 5 links, 2 domains</option>
            <option value="pro">pro — 20 links, 5 domains</option>
          </select>
        </label>
        <p className="muted">
          Created as <code>provisioning</code>. It goes live once you set the vault
          passcode, and the clock starts then.
        </p>
        <button type="submit">Create</button>
      </form>
    </main>
  );
}
