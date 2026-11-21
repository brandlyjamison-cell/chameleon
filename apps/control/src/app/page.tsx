import { redirect } from "next/navigation";
import { currentSession } from "../server/session";

export default async function Home() {
  if (await currentSession()) redirect("/services");

  return (
    <main className="mkt" id="content">
      <section className="hero">
        <div className="wrap">
          <p className="eyebrow">Credential simulation infrastructure</p>
          <h1>
            The link wears <em>their</em> brand. The capture lands in <em>your</em> vault.
          </h1>
          <p className="lede">
            Chameleon mints one link per target, serves a page that matches the service
            you pinned, and stops accepting the moment it works. Every submission is
            encrypted under a key only your passcode unwraps.
          </p>
          <div className="actions">
            <a className="btn" href="/signup">
              Start free — 2 live services
            </a>
            <a className="btn ghost" href="#how">
              How it works
            </a>
          </div>
          <p className="fine">
            No card. No script tag on the victim page. Passcode-wrapped keys, so we cannot
            read your captures.
          </p>

          <div className="bento">
            <div className="tile preview">
              <div className="frame">
                <div className="frame-bar">
                  <span className="dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="url mono">
                    https://<b>login.contoso-mail.com</b>/a7k2
                  </span>
                </div>
                <div className="mock">
                  <div className="logo" aria-hidden="true" />
                  <h4>Sign in to continue</h4>
                  <p className="sub">contoso-mail.com</p>
                  <input aria-label="Work email" placeholder="you@contoso.com" readOnly />
                  <input aria-label="Password" type="password" value="hunter2" readOnly />
                  <button className="go" type="button">
                    Sign in
                  </button>
                </div>
              </div>
            </div>

            <div className="tile half">
              <h3>One link, one target</h3>
              <p>
                A slug is bound to one service and dies after its first usable submission.
                Forwarded links stop collecting quietly instead of mixing victims
                together.
              </p>
            </div>
            <div className="tile half">
              <h3>Rendered at the edge</h3>
              <p>
                Cloudflare serves the page, not our server. A dead control plane does not
                take your live links down with it.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap" id="how">
        <div className="split">
          <div>
            <p className="eyebrow">How it works</p>
            <h2 className="section">Three steps, then it runs itself.</h2>
            <ol className="steps">
              <li>
                <div>
                  <strong>Point a hostname at it</strong>
                  <span>
                    One TXT record proves the domain. TLS is issued for you; nothing to
                    install on the target side.
                  </span>
                </div>
              </li>
              <li>
                <div>
                  <strong>Pin the brand and mint</strong>
                  <span>
                    The capture is credential-only on purpose: no OTP field unless the
                    service actually has one, so the page never looks improvised.
                  </span>
                </div>
              </li>
              <li>
                <div>
                  <strong>Unwrap and read</strong>
                  <span>
                    Your passcode unwraps the service key. Captures are decrypted in the
                    browser, exported as CSV, and retained for 30 days.
                  </span>
                </div>
              </li>
            </ol>
          </div>

          <div>
            <h2 className="section">The parts that matter when it goes wrong.</h2>
            <dl className="specs">
              <div>
                <dt>Where pages render</dt>
                <dd>Cloudflare edge</dd>
              </div>
              <div>
                <dt>Where captures rest</dt>
                <dd>Your vault, tenant-scoped</dd>
              </div>
              <div>
                <dt>Key wrapping</dt>
                <dd>AES-KW under PBKDF2</dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>30 min idle, 12 h cap</dd>
              </div>
              <div>
                <dt>Deny response</dt>
                <dd>One identical 404</dd>
              </div>
              <div>
                <dt>Retention</dt>
                <dd>30 days, export anytime</dd>
              </div>
            </dl>
            <blockquote className="quote">
              Every deny — bad host, dead slug, spent link, over the cap — returns the
              same bare 404. A victim learns nothing from the error.
            </blockquote>
          </div>
        </div>
      </section>

      <section className="wrap">
        <div className="callout">
          <p className="eyebrow">Start now</p>
          <h2>Two live services, one login, no card.</h2>
          <p className="fine">
            You get a dashboard the moment you sign up. Activation waits for a confirmed
            address; the first verification mail is on us.
          </p>
          <div className="actions">
            <a className="btn" href="/signup">
              Create an account
            </a>
            <a className="btn ghost" href="/login">
              I already have one
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
