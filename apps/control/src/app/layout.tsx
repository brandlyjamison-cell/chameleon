import type { ReactNode } from "react";
import { currentSession } from "../server/session";
import "./globals.css";

// Every page reads the session cookie.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chameleon",
  description: "Rotating capture links for credential phishing tests",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  return (
    <html lang="en">
      <body>
        <header>
          <a href={session ? "/services" : "/"} className="brand">
            chameleon
          </a>
          <nav>
            {session ? (
              <>
                <span className="who">{session.email}</span>
                <a href="/account/passkeys">passkeys</a>
                <form action="/api/logout" method="post">
                  <button type="submit" className="link">
                    sign out
                  </button>
                </form>
              </>
            ) : (
              <>
                <a href="/login">sign in</a>
                <a href="/signup">sign up</a>
              </>
            )}
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
