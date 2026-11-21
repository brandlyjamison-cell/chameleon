"use client";

import { authClient } from "../../../lib/auth-client";

export default function Passkeys() {
  return (
    <main className="app" id="content">
      <h1>Passkeys</h1>
      <p className="muted">
        A passkey is a second factor that cannot be phished with a password. Required for
        the platform admin; optional here.
      </p>
      <button
        type="button"
        onClick={async () => {
          const result = await authClient.passkey.addPasskey({
            name: navigator.platform,
          });
          if (result?.error) alert(result.error.message ?? "Could not add the passkey");
          else location.reload();
        }}
      >
        Add a passkey on this device
      </button>
      <p className="muted">
        The list and deletion controls arrive with the admin panel; one credential is
        enough to sign in with.
      </p>
    </main>
  );
}
