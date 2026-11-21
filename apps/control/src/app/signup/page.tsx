import { redirect } from "next/navigation";
import { currentSession } from "../../server/session";

const errors: Record<string, string> = {
  invalid_input:
    "Check the fields: the password needs 10+ characters with a letter and a digit.",
  credentials: "Wrong email or password.",
  rate_limited: "Too many signups from this network. Try again in an hour.",
};

export default async function Signup({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentSession()) redirect("/dashboard");
  const { error } = await searchParams;
  return (
    <main className="auth" id="content">
      <h1>Create an account</h1>
      <p className="fine" style={{ marginBottom: "1.2rem" }}>
        One login per org. No card to sign up, no seats to manage.
      </p>
      {error ? (
        <p className="error" role="alert">
          {errors[error] ?? "Signup failed."}
        </p>
      ) : null}
      <div className="card">
        <form action="/api/signup" method="post">
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" name="name" autoComplete="name" required maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor="orgName">Organisation</label>
            <input id="orgName" name="orgName" required minLength={2} maxLength={80} />
          </div>
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
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={128}
            />
            <p className="fine">At least 10 characters, with a letter and a digit.</p>
          </div>
          <button type="submit" className="btn block">
            Create account
          </button>
        </form>
      </div>
      <p className="fine" style={{ marginTop: "1rem" }}>
        Already have one? <a href="/login">Sign in</a>.
      </p>
    </main>
  );
}
