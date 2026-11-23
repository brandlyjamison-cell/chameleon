import { z } from "zod";
import { ServiceTypeCodeSchema, TierCodeSchema, GateModeSchema } from "./service";

export const EmailSchema = z.string().trim().toLowerCase().email().max(254);

/** Four digits. Short enough to type from memory, long enough for 310k PBKDF2. */
export const PasscodeSchema = z
  .string()
  .trim()
  .regex(/^\d{4}$/, "4 digits");

export const SignupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: EmailSchema,
  password: z.string().min(10).max(128),
  orgName: z.string().trim().min(2).max(80),
});

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
});

export const CreateServiceSchema = z.object({
  serviceType: ServiceTypeCodeSchema,
  tier: TierCodeSchema,
  /** Tenant-defined; falls back to "Chameleon Starter" when omitted. */
  name: z.string().trim().min(2).max(60).optional(),
});

export const ActivateSchema = z.object({
  passcode: PasscodeSchema,
  gateMode: GateModeSchema.default("always"),
});

/** The only service fields an API response may carry (INV-DATA-06, no DEK). */
export interface ServiceView {
  id: string;
  status: string;
  name: string;
  /** Scopes the free preview path; never a secret, never reused. */
  previewKey: string;
  /** The preview link's slug, null until it is minted. */
  previewSlug: string | null;
  serviceType: string;
  tier: string;
  gateMode: string;
  expiresAt: string | null;
  activatedAt: string | null;
  createdAt: string;
  paidUntil: string | null;
  priceCents: number;
  linkCap: number;
  hostnameCap: number;
  linksUsed: number;
  hostnamesUsed: number;
}

export const SERVICE_VIEW_FIELDS = [
  "id",
  "status",
  "name",
  "preview_key",
  "service_type",
  "tier",
  "gate_mode",
  "expires_at",
  "activated_at",
  "created_at",
  "paid_until",
  "price_cents",
] as const;

/** A root domain, as typed by the tenant. Normalisation happens server-side. */
export const DomainSchema = z.object({
  root: z.string().trim().min(4).max(253),
});

/** A label under a verified root; the FQDN is derived, never typed. */
export const HostnameSchema = z.object({
  domainId: z.string().uuid(),
  label: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "bad_label"),
});

/**
 * Every field the tenant must publish for the root, plus enough state to explain
 * a failure. `routing` is null until the provider entitlement exists, at which
 * point it is the single wildcard CNAME.
 */
export interface OrgDomainView {
  id: string;
  root: string;
  status: string;
  routingState: "dns_pending" | "waiting" | "active";
  reviewNeeded: boolean;
  verifyName: string;
  verifyValue: string;
  recordType: "TXT";
  ttl: 300;
  routing: { type: "CNAME"; name: string; value: string } | null;
  /** The platform wildcard target, whether or not routing is ready. */
  target: string;
  detail: string | null;
  checkedAt: string | null;
  lastResult: "match" | "mismatch" | "error" | null;
  hostnameCount: number;
}

export interface HostnameView {
  id: string;
  domainId: string;
  serviceId: string;
  fqdn: string;
  label: string;
  status: string;
  createdAt: string;
}
