import { z } from "zod";

export const ServiceTypeCodeSchema = z.enum(["chameleon", "aitm"]);
export type ServiceTypeCode = z.infer<typeof ServiceTypeCodeSchema>;

export const TierCodeSchema = z.enum(["starter", "pro"]);
export type TierCode = z.infer<typeof TierCodeSchema>;

/** The entitlement value an edge reads. Default deny on a miss (INV-EDGE-03). */
export const EntitlementSchema = z.enum(["active", "past_due", "expired"]);
export type Entitlement = z.infer<typeof EntitlementSchema>;

export const GateModeSchema = z.enum(["always", "remember_30d", "off"]);
export type GateMode = z.infer<typeof GateModeSchema>;
