import "server-only";

const base = process.env.CF_API_BASE ?? "https://api.cloudflare.com/client/v4";
const token = process.env.CLOUDFLARE_API_KEY;
const zone = process.env.CLOUDFLARE_ZONE_ID;

export class CfUnavailable extends Error {
  readonly status = 503;
  constructor(readonly code: "cf_unavailable" | "cf_entitlement_missing") {
    super(code);
  }
}

interface CfAnswer<T> {
  success: boolean;
  errors?: Array<{ code: number; message: string }>;
  result: T;
}

async function call<T>(path: string, init?: RequestInit): Promise<CfAnswer<T>> {
  if (!token || !zone) throw new CfUnavailable("cf_unavailable");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(8000),
  });
  const body = (await res.json()) as CfAnswer<T>;
  if (!body.success) {
    // 1404: the zone has no SaaS quota (OPEN-OPS-04). Anything else is a fault.
    if (body.errors?.some((error) => error.code === 1404)) {
      throw new CfUnavailable("cf_entitlement_missing");
    }
    throw new CfUnavailable("cf_unavailable");
  }
  return body;
}

export interface CustomHostname {
  id: string;
  status: string;
}

/** TLS is issued by Cloudflare's DV flow; the tenant needs no certificate. */
export async function createCustomHostname(hostname: string): Promise<CustomHostname> {
  const body = await call<CustomHostname>(`/zones/${zone}/custom_hostnames`, {
    method: "POST",
    body: JSON.stringify({ hostname, ssl: { method: "http", type: "dv" } }),
  });
  return body.result;
}

export async function getCustomHostname(id: string): Promise<CustomHostname> {
  const body = await call<CustomHostname>(`/zones/${zone}/custom_hostnames/${id}`);
  return body.result;
}
