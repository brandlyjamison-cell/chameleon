import { z } from "zod";
import { ServiceTypeCodeSchema } from "./service";

/**
 * The KV resolution document for one slug on one host. The edge trusts this or
 * 404s; it never queries Postgres on the render path (INV-EDGE-01).
 */
export const LinkResolveSchema = z.object({
  v: z.literal(1),
  linkId: z.string().uuid(),
  serviceId: z.string().uuid(),
  orgId: z.string().uuid(),
  serviceType: ServiceTypeCodeSchema,
  slug: z.string().regex(/^[0-9A-HJ-NP-TV-Z]{5}$/),
  pin: z.string().uuid().nullable(),
  token: z.string().min(16),
  status: z.enum(["active", "paused"]),
});
export type LinkResolve = z.infer<typeof LinkResolveSchema>;

/** Everything an engine needs before it decides a template. */
export const ResolveInputSchema = z.object({
  link: LinkResolveSchema,
  email: z.string().email().max(320).nullable(),
  requestHost: z.string().min(1).max(253),
});
export type ResolveInput = z.infer<typeof ResolveInputSchema>;

/** A resolved render: which template, and where the visitor goes afterwards. */
export const ResolvedTemplateSchema = z.object({
  source: z.enum(["pin", "brand_map", "profile", "cpanel"]),
  brandSlug: z.string().min(1),
  stepCount: z.union([z.literal(1), z.literal(2)]),
  step: z.union([z.literal(1), z.literal(2)]).default(1),
  prefilledEmail: z.string().email().max(320).nullable(),
  redirectTo: z.string().url(),
});
export type ResolvedTemplate = z.infer<typeof ResolvedTemplateSchema>;
