import { redirect } from "next/navigation";
import { currentSession } from "../server/session";

export default async function Home() {
  if (await currentSession()) redirect("/dashboard");

  return (
    <main className="mkt" id="content">
      <section className="hero">
        <div>
          <p className="eyebrow">Credential simulation infrastructure</p>
          <h1>The link wears their brand. The capture lands in your vault.</h1>
          <p className="sub">
            One link per target. A page that matches the service you pinned. Every submit
            stored under a key only your passcode unwraps — and forwarded wherever you
            ask.
          </p>
          <div className="go">
            <a className="btn" href="/signup">
              Start free
            </a>
            <a className="btn ghost" href="#how">
              How it works
            </a>
          </div>
          <p className="fine">
            No card to sign up. No script tag on the target. Credential-only capture, so
            the page never invents a field it should not have.
          </p>
        </div>

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
            <div className="logo" aria-hidden="true">
              C
            </div>
            <h3>Sign in to continue</h3>
            <p className="fine" style={{ marginBottom: "0.8rem" }}>
              contoso-mail.com
            </p>
            <div className="mockfield">you@contoso.com</div>
            <div className="mockfield">••••••••</div>
            <div className="btn block" aria-hidden="true">
              Sign in
            </div>
            <p className="fine" style={{ marginTop: "0.8rem" }}>
              A bare 404, not a stack trace, when the link is spent.
            </p>
          </div>
        </div>
      </section>

      <section className="section mkt" id="how">
        <p className="eyebrow">How it works</p>
        <h2>Point, pin, read.</h2>
        <ol className="steps" style={{ marginTop: "1.2rem" }}>
          <li>
            <strong>Point a hostname at it</strong>
            <p className="muted">
              One ownership TXT record and one routing record, with a copy button per
              value. TLS is issued for you.
            </p>
          </li>
          <li>
            <strong>Pin the brand and mint</strong>
            <p className="muted">
              A slug is bound to one service and one brand. The capture form matches what
              that brand actually asks for.
            </p>
          </li>
          <li>
            <strong>Read or forward</strong>
            <p className="muted">
              Captures land in the vault, encrypted under your service passcode. Mail them
              out to a verified address, or export CSV.
            </p>
          </li>
        </ol>
      </section>

      <section className="section mkt">
        <div className="split">
          <div>
            <p className="eyebrow">Design decisions</p>
            <h2>Built to fail quietly in the right places.</h2>
            <div className="bento" style={{ marginTop: "1.1rem" }}>
              <div className="card">
                <h3>Deny is identical</h3>
                <p className="muted">
                  Bad host, dead slug, spent link, lapsed payment — the same bare 404. A
                  victim learns nothing from the error.
                </p>
              </div>
              <div className="card">
                <h3>Edge-first rendering</h3>
                <p className="muted">
                  Cloudflare serves the page, not the control plane. A deploy or a reboot
                  does not take live links down.
                </p>
              </div>
              <div className="card">
                <h3>Tenant walls in the database</h3>
                <p className="muted">
                  Row-level security, not query discipline. A missed filter returns
                  nothing rather than someone else&apos;s row.
                </p>
              </div>
              <div className="card">
                <h3>Honest delivery</h3>
                <p className="muted">
                  Mail is queued, retried and visible. A provider throttle parks the row
                  instead of burning the retry budget.
                </p>
              </div>
            </div>
          </div>

          <div>
            <h2>Facts</h2>
            <dl className="specs">
              <div className="tile">
                <dt className="fine">Where pages render</dt>
                <dd>
                  <strong>Cloudflare edge</strong>
                </dd>
              </div>
              <div className="tile">
                <dt className="fine">Where captures rest</dt>
                <dd>
                  <strong>Your tenant vault</strong>
                </dd>
              </div>
              <div className="tile">
                <dt className="fine">Key wrapping</dt>
                <dd>
                  <strong>AES-KW under PBKDF2</strong>
                </dd>
              </div>
              <div className="tile">
                <dt className="fine">Session</dt>
                <dd>
                  <strong>30 min idle, 12 h cap</strong>
                </dd>
              </div>
              <div className="tile">
                <dt className="fine">Retention</dt>
                <dd>
                  <strong>30 days, export anytime</strong>
                </dd>
              </div>
              <div className="tile">
                <dt className="fine">Billing</dt>
                <dd>
                  <strong>Per service, 30 days</strong>
                </dd>
              </div>
            </dl>
            <blockquote className="quote" style={{ marginTop: "1.2rem" }}>
              “Credentials only. An OTP box that never sees an OTP is worse than no box.”
            </blockquote>
          </div>
        </div>
      </section>

      <section className="section mkt">
        <div className="callout">
          <div>
            <p className="eyebrow">Start now</p>
            <h2>One login, one org, your own vault.</h2>
            <p className="muted">
              Activation waits for a confirmed address. The first verification mail is on
              us.
            </p>
          </div>
          <div className="actions">
            <a className="btn" href="/signup">
              Create an account
            </a>
            <a className="btn ghost" href="/login">
              Sign in
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
