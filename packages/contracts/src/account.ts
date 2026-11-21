import { z } from "zod";
import { ServiceTypeCodeSchema, TierCodeSchema, GateModeSchema } from "./service";

export const EmailSchema = z.string().trim().toLowerCase().email().max(254);

/** 10–128, at least one letter and one digit. Deliberately not fussy. */
export const PasscodeSchema = z
  .string()
  .min(10)
  .max(128)
  .regex(/[A-Za-z]/, "needs a letter")
  .regex(/[0-9]/, "needs a digit");

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
});

export const ActivateSchema = z.object({
  passcode: PasscodeSchema,
  gateMode: GateModeSchema.default("always"),
});

/** The only service fields an API response may carry (INV-DATA-06, no DEK). */
export interface ServiceView {
  id: string;
  status: string;
  serviceType: string;
  tier: string;
  gateMode: string;
  emailVerified: boolean;
  expiresAt: string | null;
  activatedAt: string | null;
  createdAt: string;
}

export const SERVICE_VIEW_FIELDS = [
  "id",
  "status",
  "service_type",
  "tier",
  "gate_mode",
  "expires_at",
  "activated_at",
  "created_at",
] as const;

/** A bare hostname; normalisation and the real check are server-side. */
export const DomainSchema = z.object({
  hostname: z.string().trim().min(4).max(253),
});

/** What a tenant needs to publish the TXT record and read the state. */
export interface DomainView {
  id: string;
  hostname: string;
  status: string;
  verifyName: string;
  verifyValue: string;
  detail: string | null;
  checkedAt: string | null;
}
