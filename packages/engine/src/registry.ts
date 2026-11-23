import type { ServiceTypeCode } from "@chameleon/contracts";
import { chameleon } from "./chameleon";
import type { Engine } from "./types";

/**
 * The only switch over service types. Adding a type is a row plus an engine, never
 * a route change (INV-ARCH-02).
 */
const engines: ReadonlyMap<ServiceTypeCode, Engine> = new Map([["chameleon", chameleon]]);

export function engineFor(code: ServiceTypeCode): Engine {
  const engine = engines.get(code);
  if (engine === undefined)
    throw new Error(`no engine registered for service_type ${code}`);
  return engine;
}

/** The fallback name for a service the tenant left unnamed. */
export function defaultServiceName(code: ServiceTypeCode, tier: string): string {
  const label = engines.get(code)?.label ?? code;
  return `${label} ${tier.charAt(0).toUpperCase()}${tier.slice(1)}`;
}

export function registeredCodes(): ServiceTypeCode[] {
  return [...engines.keys()];
}
