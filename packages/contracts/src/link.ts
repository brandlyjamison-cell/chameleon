import { z } from "zod";
import { ServiceTypeCodeSchema } from "./service";
import { CaptureKindSchema } from "./capture";

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

/**
 * A resolved render. Carries the whole look, not just the brand name: a cloned
 * profile supplies the palette and labels, a pinned brand its stored ones.
 */
export const PaletteSchema = z
  .object({
    bg: z.string().max(32),
    surface: z.string().max(32),
    fg: z.string().max(32),
    accent: z.string().max(32),
    radius: z.string().max(16),
    font: z.string().max(120),
  })
  .partial();

export const LabelsSchema = z
  .object({
    heading: z.string().max(120),
    email: z.string().max(60),
    password: z.string().max(60),
    submit: z.string().max(60),
  })
  .partial();

export const ResolvedTemplateSchema = z.object({
  source: z.enum(["pin", "brand_map", "profile", "cpanel"]),
  brandSlug: z.string().min(1),
  stepCount: z.union([z.literal(1), z.literal(2)]),
  step: z.union([z.literal(1), z.literal(2)]).default(1),
  prefilledEmail: z.string().email().max(320).nullable(),
  redirectTo: z.string().url(),
  /** Capture endpoint fragment and the stored kind (engine decides). */
  token: z.string().min(1),
  action: z.string().max(300).optional(),
  kind: CaptureKindSchema,
  title: z.string().max(120).optional(),
  palette: PaletteSchema.optional(),
  labels: LabelsSchema.optional(),
  logoUrl: z.string().max(300).nullable().optional(),
  backdropUrl: z.string().max(300).nullable().optional(),
});
export type ResolvedTemplate = z.infer<typeof ResolvedTemplateSchema>;

/** One preview render as the public route sees it. */
export const PreviewRenderSchema = ResolvedTemplateSchema.extend({
  linkId: z.string().uuid(),
  orgId: z.string().uuid(),
  serviceId: z.string().uuid(),
  serviceType: ServiceTypeCodeSchema,
  slug: z.string(),
});
export type PreviewRender = z.infer<typeof PreviewRenderSchema>;
