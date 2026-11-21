import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import { currentSession } from "../server/session";
import "./globals.css";

// Every page reads the session cookie.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chameleon — rotating capture links",
  description:
    "One link per target, a page that matches the brand you pinned, and every captured credential in a vault only the tenant can open.",
};

const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

const mark = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 3 4.5 7.2v9.6L12 21l7.5-4.2V7.2L12 3Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="2.4" fill="currentColor" />
  </svg>
);

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <a className="skip" href="#content">
          Skip to content
        </a>
        <header className="site">
          <a href={session ? "/services" : "/"} className="brand">
            {mark}
            chameleon
          </a>
          <nav>
            {session ? (
              <>
                <a href="/services">services</a>
                {session.isAdmin && <a href="/admin">admin</a>}
                <span className="who">{session.email}</span>
                <form action="/api/logout" method="post">
                  <button type="submit" className="link">
                    sign out
                  </button>
                </form>
              </>
            ) : (
              <>
                <a href="/#how">how it works</a>
                <a href="/login">sign in</a>
                <a href="/signup" className="btn">
                  Start free
                </a>
              </>
            )}
          </nav>
        </header>
        {children}
        {!session && (
          <footer className="site">
            <span>Chameleon — rotating capture links for credential simulations.</span>
            <span>
              <a href="/login">sign in</a> · <a href="/signup">create an account</a>
            </span>
          </footer>
        )}
      </body>
    </html>
  );
}
