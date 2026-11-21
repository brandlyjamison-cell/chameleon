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

export function registeredCodes(): ServiceTypeCode[] {
  return [...engines.keys()];
}
