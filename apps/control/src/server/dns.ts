import "server-only";

export class DnsUnavailable extends Error {
  readonly code = "dns_unavailable";
}

/**
 * DoH, not a local resolver: the box has no stub resolver configured and this
 * keeps the check independent of whatever `resolv.conf` says.
 */
export async function lookupTxt(name: string): Promise<string[]> {
  const base = process.env.DNS_JSON_URL ?? "https://cloudflare-dns.com/dns-query";
  const res = await fetch(`${base}?name=${encodeURIComponent(name)}&type=TXT`, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new DnsUnavailable(`doh ${res.status}`);
  const body = (await res.json()) as { Answer?: Array<{ type: number; data: string }> };
  return (body.Answer ?? [])
    .filter((answer) => answer.type === 16)
    .map((answer) =>
      answer.data.replace(/^"/, "").replace(/"$/, "").replace(/\\"/g, '"'),
    );
}

/** The record the tenant must publish (arch/edge.md). */
export function txtName(hostname: string): string {
  return `_chameleon.${hostname}`;
}

export function txtValue(token: string): string {
  return `cameleon-verify=${token}`;
}

export function hasMatch(records: string[], token: string): boolean {
  const wanted = txtValue(token);
  return records.some((record) => record.trim() === wanted);
}
