import { redirect } from "next/navigation";
import { currentSession } from "../../server/session";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentSession()) redirect("/services");
  const { error } = await searchParams;
  return (
    <>
      <h1>Sign in</h1>
      {error && <p className="error">Wrong email or password.</p>}
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
      <p className="muted">
        No account? <a href="/signup">Create one</a>.
      </p>
    </>
  );
}
