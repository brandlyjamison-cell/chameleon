import type { CaptureKind } from "@chameleon/contracts";

/**
 * The only DOM-shaped input the skeleton accepts. Pure values, no bindings, no
 * clock, so the same call renders in a Worker and in the dashboard preview.
 */
export interface RenderTemplate {
  readonly brandSlug: string;
  readonly title: string;
  readonly heading: string;
  readonly emailLabel: string;
  readonly passwordLabel: string;
  readonly submitLabel: string;
  readonly palette: {
    readonly bg: string;
    readonly surface: string;
    readonly fg: string;
    readonly accent: string;
    readonly radius: string;
    readonly font: string;
  };
  readonly logoRef: string | null;
  readonly backdropRef: string | null;
  readonly prefilledEmail: string | null;
  readonly stepCount: 1 | 2;
  readonly step: 1 | 2;
  readonly token: string;
  readonly kind: CaptureKind;
}

const escape = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Renders the shell. Chameleon only: no OTP field here (INV-CAP-04). */
export function render(t: RenderTemplate): string {
  const emailField = `<label for="email">${escape(t.emailLabel)}</label>
      <input id="email" name="email" type="email" autocomplete="username" value="${escape(
        t.prefilledEmail ?? "",
      )}" required />`;
  const passwordField = `<label for="password">${escape(t.passwordLabel)}</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />`;

  let heading = t.heading;
  let fields: string;
  let nextStep = "";

  if (t.stepCount === 1) {
    fields = `${emailField}\n${passwordField}`;
  } else if (t.step === 1) {
    fields = emailField;
    nextStep = `<input type="hidden" name="step" value="2" />`;
  } else {
    heading = t.heading;
    fields = `<input type="hidden" name="email" value="${escape(
      t.prefilledEmail ?? "",
    )}" />\n${passwordField}`;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escape(t.title)}</title>
${t.logoRef === null ? "" : `<link rel="icon" href="${escape(t.logoRef)}">`}
<style>
:root{--bg:${t.palette.bg};--surface:${t.palette.surface};--fg:${t.palette.fg};--accent:${t.palette.accent};--radius:${t.palette.radius}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);font-family:${t.palette.font};color:var(--fg)}
main{width:100%;max-width:360px;padding:32px;background:var(--surface);border-radius:var(--radius)}
button{width:100%;padding:12px;border:0;border-radius:var(--radius);background:var(--accent);color:#fff;font-size:16px}
label,input{display:block;width:100%}input{margin:6px 0 16px;padding:10px;border:1px solid #ccc;border-radius:var(--radius)}
</style>
</head>
<body>
<main>
<h1>${escape(heading)}</h1>
<form method="post" action="/c/${escape(t.token)}">
${fields}
${nextStep}
<button type="submit">${escape(t.submitLabel)}</button>
</form>
</main>
</body>
</html>`;
}
