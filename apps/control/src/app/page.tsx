import { redirect } from "next/navigation";
import { currentSession } from "../server/session";

export default async function Home() {
  if (await currentSession()) redirect("/services");
  return (
    <>
      <h1>Chameleon</h1>
      <p className="muted">
        Rotating capture links for credential phishing simulations. One link per victim,
        one page per brand, captured submissions in one vault.
      </p>
      <div className="card">
        <p>
          A link is minted for one target and dies after its first usable capture. The
          page looks like the brand you pinned; nothing is rendered client-side and there
          is no third-party script.
        </p>
      </div>
      <p>
        <a href="/signup">Create an account</a> or <a href="/login">sign in</a>.
      </p>
    </>
  );
}
