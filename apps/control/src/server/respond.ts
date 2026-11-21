import "server-only";
import { ZodError } from "zod";
import { CapError, NotFoundError } from "@chameleon/db";
import { HttpError } from "./errors";

export function json(body: unknown, status = 200, headers?: Headers): Response {
  const out = new Response(JSON.stringify(body), { status });
  out.headers.set("content-type", "application/json; charset=utf-8");
  out.headers.set("cache-control", "no-store");
  headers?.forEach((value, key) => {
    if (key === "content-type") return;
    out.headers.append(key, value);
  });
  return out;
}

/** 303 keeps the browser on GET after a form post. */
export function seeOther(location: string, headers?: Headers): Response {
  const out = new Response(null, { status: 303 });
  out.headers.set("location", location);
  headers?.forEach((value, key) => {
    if (key === "location") return;
    out.headers.append(key, value);
  });
  return out;
}

export async function readBody(req: Request): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return req.json();
  const form = await req.formData();
  return Object.fromEntries(form);
}

const messages: Record<string, string> = {
  invalid_input: "Check the fields and try again.",
  unauthenticated: "Sign in first.",
  owner_only: "Only the org owner can do that.",
  email_unverified: "Verify your email before activating.",
  passcode_mismatch: "That passcode does not match the one already set.",
  no_org: "Your account has no org yet.",
  service_not_active: "Activate the service before adding a hostname.",
  domain_exists: "That hostname is already attached.",
  domain_tombstoned: "Another org used that hostname in the last 30 days.",
  domain_slots_exhausted: "No domain slots left on this tier.",
  zone_full: "The platform is at its live-domain ceiling.",
  bad_hostname: "That is not a hostname.",
};

export function handleError(error: unknown): Response {
  if (error instanceof HttpError) {
    return json(
      { error: error.code, message: messages[error.code] ?? error.code },
      error.status,
    );
  }
  if (error instanceof ZodError) {
    const fields = error.issues.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    return json({ error: "invalid_input", message: messages.invalid_input, fields }, 422);
  }
  // `instanceof` is unreliable across route bundles, so these are matched by shape.
  if (error instanceof NotFoundError || (error as { status?: number }).status === 404) {
    return json({ error: "not_found", message: "Not found." }, 404);
  }
  if (error instanceof CapError || (error as { status?: number }).status === 409) {
    // CapError carries `domain_slots_exhausted` / `link_slots_exhausted`.
    const code = (error as { message?: string }).message ?? "";
    const slot = code.endsWith("_slots_exhausted") ? code : "cap";
    return json({ error: slot, message: "No slots left on this tier." }, 409);
  }
  console.error(error);
  return json({ error: "internal", message: "Something broke." }, 500);
}

/** Form posts get a browser-friendly redirect back with `?error=`. */
export function backWithError(at: string, error: unknown): Response {
  if (!(error instanceof HttpError)) console.error("[form]", error);
  const code = error instanceof HttpError ? error.code : "invalid_input";
  return seeOther(`${at}?error=${encodeURIComponent(code)}`);
}
