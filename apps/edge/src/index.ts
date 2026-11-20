import { notFoundResponse } from "@chameleon/contracts";

/**
 * Stage 1 placeholder handler. The real router (host check, entitlement gate,
 * token, engine) arrives in stage 5; until then every request is the bare 404,
 * which is also the correct default-deny answer (INV-EDGE-03).
 */
export function handle(_request: Request): Response {
  return notFoundResponse();
}

export default { fetch: handle };
