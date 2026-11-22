import { redirect } from "next/navigation";
import { currentSession } from "../../server/session";
import { PageHeader, StatusPill } from "../../components/ui";

export default async function Welcome({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.orgId) redirect("/login");
  const { sent, error } = await searchParams;

  return (
    <main className="app narrow" id="content">
      <PageHeader
        eyebrow="Account"
        title={session.emailVerified ? "You are ready" : "Confirm your email"}
        lede={
          session.emailVerified
            ? "The address is confirmed. Create a service, pick a tier and set its vault passcode."
            : "We sent a confirmation link. You can build now, but activation waits for the address."
        }
        actions={
          session.emailVerified ? (
            <StatusPill status="verified" />
          ) : (
            <span className="pill warn">Unconfirmed</span>
          )
        }
      />

      {error ? (
        <p className="error" role="alert">
          The resend did not go through. Try again in a moment.
        </p>
      ) : null}
      {sent ? (
        <p className="ok">Sent again. Check the inbox and the spam folder.</p>
      ) : null}

      <div className="card">
        <dl className="kv">
          <dt>Email</dt>
          <dd>{session.email}</dd>
          <dt>Link lifetime</dt>
          <dd>24 hours</dd>
        </dl>
        {session.emailVerified ? null : (
          <form action="/api/verify/resend" method="post" style={{ marginTop: "0.9rem" }}>
            <input type="hidden" name="email" value={session.email} />
            <button type="submit" className="btn ghost">
              Resend the link
            </button>
          </form>
        )}
      </div>

      <div className="actions" style={{ marginTop: "1rem" }}>
        <a className="btn" href="/services/new">
          Create a service
        </a>
        <a className="btn ghost" href="/dashboard">
          Go to overview
        </a>
      </div>
    </main>
  );
}
