export default function NotFound() {
  return (
    <main className="app" id="content">
      <p className="eyebrow">404</p>
      <h1>Nothing here</h1>
      <p className="muted">
        The page does not exist, or it belongs to another account. The address bar is the
        truth; try the dashboard.
      </p>
      <p>
        <a className="btn" href="/services">
          Go to services
        </a>
      </p>
    </main>
  );
}
