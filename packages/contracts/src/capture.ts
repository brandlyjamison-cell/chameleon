import { z } from "zod";

/** Capture provenance. Server-set only (INV-CAP-08). */
export const CaptureSourceSchema = z.enum(["human", "decoy", "scanner"]);
export type CaptureSource = z.infer<typeof CaptureSourceSchema>;

/**
 * Capture mode. The service_type decides which values are legal; the client is
 * never consulted (INV-CAP-03). `session` and `mixed` are reserved for aitm and
 * are unreachable from a chameleon engine.
 */
export const CaptureKindSchema = z.enum(["credential", "session", "mixed"]);
export type CaptureKind = z.infer<typeof CaptureKindSchema>;

export const CaptureStatusSchema = z.enum(["new", "valid", "invalid"]);
export type CaptureStatus = z.infer<typeof CaptureStatusSchema>;

/** What an engine may return from `parseCapture`. */
export const EngineCaptureSchema = z.object({
  kind: CaptureKindSchema,
  fields: z.record(z.string().max(4096)).refine((f) => Object.keys(f).length > 0, {
    message: "fields must not be empty",
  }),
});
export type EngineCapture = z.infer<typeof EngineCaptureSchema>;

/** A stored row, as the vault reads it. `fields` is the sealed envelope. */
export const CaptureRowSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  serviceId: z.string().uuid(),
  linkId: z.string().uuid(),
  kind: CaptureKindSchema,
  source: CaptureSourceSchema,
  status: CaptureStatusSchema,
  payloadRef: z.string().nullable(),
  receivedAt: z.string().datetime(),
});
export type CaptureRow = z.infer<typeof CaptureRowSchema>;

export const CredentialFieldsSchema = z.object({
  username: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(1024),
});

/**
 * Builds the accepted capture from the engine's verdict.
 *
 * Any `kind` the browser posts is discarded: a chameleon link that receives
 * `kind=session` still stores `credential`. This is the code that makes
 * INV-CAP-03 true.
 */
export function buildCapture(input: {
  engineKind: CaptureKind;
  fields: Record<string, unknown>;
  clientKind?: unknown;
}): EngineCapture {
  const parsed = EngineCaptureSchema.parse({
    kind: input.engineKind,
    fields: input.fields,
  });
  // Touch the client value only to prove it is not used.
  void input.clientKind;
  return parsed;
}

/** Strict credential parse: trims, caps, rejects an empty password. */
export function parseCredentialFields(raw: { username?: unknown; password?: unknown }): {
  username: string;
  password: string;
} {
  return CredentialFieldsSchema.parse({
    username: typeof raw.username === "string" ? raw.username.trim() : "",
    password: raw.password,
  });
}
