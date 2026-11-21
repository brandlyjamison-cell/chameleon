import { redirect } from "next/navigation";
import { currentSession } from "../../server/session";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; email?: string }>;
}) {
  if (await currentSession()) redirect("/services");
  const { error, sent, email } = await searchParams;
  return (
    <main className="auth" id="content">
      <h1>Sign in</h1>
      <p className="hint">
        Use the address and password you signed up with. Sessions end after 30 idle
        minutes.
      </p>
      {sent && <p className="muted">Sent. Check the inbox and the spam folder.</p>}
      {error && (
        <p className="error">
          {error === "unverified"
            ? "That address is not confirmed yet — check your inbox, or sign in and resend."
            : "Wrong email or password."}
        </p>
      )}
      <div className="card">
        <form action="/api/login" method="post">
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button type="submit">Sign in</button>
        </form>
      </div>
      {error === "unverified" && email && (
        <form action="/api/verify/resend" method="post">
          <input type="hidden" name="email" value={email} />
          <button type="submit" className="link">
            Resend the confirmation to {email}
          </button>
        </form>
      )}
      <p className="foot">
        No account? <a href="/signup">Create one</a>.
      </p>
    </main>
  );
}
