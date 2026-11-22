import "server-only";

import { engineFor } from "@chameleon/engine";
import { render } from "@chameleon/skeleton";

/**
 * Server-only preview path. The dashboard never resolves a template in the
 * browser (INV-EDGE-01); it calls this and streams the string.
 *
 * The `server-only` import is also what `check:no-client-resolution` looks for.
 */
export async function previewHtml(email: string | null): Promise<string> {
  const engine = engineFor("chameleon");
  const template = await engine.resolve({
    link: {
      v: 1,
      linkId: "00000000-0000-7000-8000-000000000000",
      serviceId: "00000000-0000-7000-8000-000000000001",
      orgId: "00000000-0000-7000-8000-000000000002",
      serviceType: "chameleon",
      slug: "A7K2Z",
      pin: null,
      token: "preview",
      status: "active",
    },
    email,
    requestHost: "preview.local",
  });
  return render({
    ...template,
    brandSlug: template.brandSlug,
    title: template.title ?? template.brandSlug,
    heading: template.labels?.heading ?? "Sign in",
    emailLabel: template.labels?.email ?? "Email",
    passwordLabel: template.labels?.password ?? "Password",
    submitLabel: template.labels?.submit ?? "Sign in",
    palette: {
      bg: template.palette?.bg ?? "#f4f4f5",
      surface: template.palette?.surface ?? "#ffffff",
      fg: template.palette?.fg ?? "#18181b",
      accent: template.palette?.accent ?? "#ff6c2f",
      radius: template.palette?.radius ?? "6px",
      font: template.palette?.font ?? "system-ui, sans-serif",
    },
    logoRef: template.logoUrl ?? null,
    backdropRef: template.backdropUrl ?? null,
    stepCount: template.stepCount,
    step: template.step,
    token: "preview",
    action: template.action,
    kind: "credential",
  });
}
