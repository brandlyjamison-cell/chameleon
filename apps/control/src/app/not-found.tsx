export default function NotFound() {
  return (
    <main className="app narrow" id="content">
      <p className="eyebrow">404</p>
      <h1>Nothing here</h1>
      <p className="muted">
        The page does not exist, or it belongs to another account. The address bar is the
        truth.
      </p>
      <div className="actions">
        <a className="btn" href="/dashboard">
          Overview
        </a>
        <a className="btn ghost" href="/services">
          Services
        </a>
      </div>
    </main>
  );
}
