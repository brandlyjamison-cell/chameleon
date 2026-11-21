import { redirect } from "next/navigation";
import { currentSession } from "../../server/session";

const errors: Record<string, string> = {
  invalid_input:
    "Check the fields: password needs 10+ characters with a letter and a digit.",
  credentials: "Wrong email or password.",
};

export default async function Signup({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentSession()) redirect("/services");
  const { error } = await searchParams;
  return (
    <main className="auth" id="content">
      <h1>Create an account</h1>
      <p className="hint">
        One login per org. Two live services included; no card, no seats to manage.
      </p>
      {error && <p className="error">{errors[error] ?? "Signup failed."}</p>}
      <div className="card">
        <form action="/api/signup" method="post">
          <label>
            Your name
            <input name="name" autoComplete="name" required maxLength={80} />
          </label>
          <label>
            Org name
            <input name="orgName" required minLength={2} maxLength={80} />
          </label>
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={128}
            />
          </label>
          <button type="submit">Create account</button>
        </form>
      </div>
      <p className="foot">
        Already have one? <a href="/login">Sign in</a>.
      </p>
    </main>
  );
}
