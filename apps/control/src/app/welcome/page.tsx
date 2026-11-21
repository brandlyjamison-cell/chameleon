import { redirect } from "next/navigation";
import { currentSession } from "../../server/session";

export default async function Welcome({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (!session.orgId) redirect("/login");
  const { sent } = await searchParams;

  return (
    <main className="app" id="content">
      <h1>One more step</h1>
      {session.emailVerified ? (
        <>
          <p>
            Your email is verified. Create a service, then set its vault passcode to
            activate it.
          </p>
          <p>
            <a href="/services/new">Create a service</a>
          </p>
        </>
      ) : (
        <>
          <p>
            We sent a verification link to <strong>{session.email}</strong>. You can
            create a service now, but activation waits until the address is verified.
          </p>
          {sent && (
            <p className="muted">Sent again. Check the inbox and the spam folder.</p>
          )}
          <form action="/api/verify/resend" method="post">
            <input type="hidden" name="email" value={session.email} />
            <button type="submit">Resend the link</button>
          </form>
          <p>
            <a href="/services/new">Create a service anyway</a>
          </p>
        </>
      )}
      <p className="muted">
        The link is valid for 24 hours. If it never arrives, resend it above and check the
        spam folder.
      </p>
    </main>
  );
}
