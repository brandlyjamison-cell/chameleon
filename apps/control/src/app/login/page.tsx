import { redirect } from "next/navigation";
import { currentSession } from "../../server/session";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; email?: string }>;
}) {
  if (await currentSession()) redirect("/dashboard");
  const { error, sent, email } = await searchParams;
  return (
    <main className="auth" id="content">
      <h1>Sign in</h1>
      <p className="fine" style={{ marginBottom: "1.2rem" }}>
        Use the address and password you signed up with. Sessions end after 30 idle
        minutes.
      </p>
      {sent ? <p className="ok">Sent. Check the inbox and the spam folder.</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error === "unverified"
            ? "That address is not confirmed yet — check your inbox, or resend below."
            : error === "rate_limited"
              ? "Too many attempts. Wait a few minutes."
              : "Wrong email or password."}
        </p>
      ) : null}
      <div className="card">
        <form action="/api/login" method="post">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <button type="submit" className="btn block">
            Sign in
          </button>
        </form>
        {error === "unverified" && email ? (
          <form action="/api/verify/resend" method="post" style={{ marginTop: "0.8rem" }}>
            <input type="hidden" name="email" value={email} />
            <button type="submit" className="link">
              Resend the confirmation to {email}
            </button>
          </form>
        ) : null}
      </div>
      <p className="fine" style={{ marginTop: "1rem" }}>
        No account? <a href="/signup">Create one</a>.
      </p>
    </main>
  );
}
