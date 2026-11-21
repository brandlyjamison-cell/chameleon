import "server-only";
import { requireDb } from "./db";

/**
 * Fixed-window abuse limit. Deliberately coarse: the point is to stop a script,
 * not to police a shared office IP. A failure to record never blocks the action.
 */
export async function withinLimit(
  bucket: string,
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const safe = key.toLowerCase().slice(0, 200) || "unknown";
  try {
    const { rows } = await requireDb().pool.query<{ ok: boolean }>(
      "select rate_hit($1, $2, make_interval(secs => $3::double precision)) as ok",
      [`${bucket}:${safe}`, limit, windowSec],
    );
    return rows[0]?.ok !== false;
  } catch (error) {
    console.warn(`[limit] ${bucket} unavailable:`, (error as Error).message);
    return true;
  }
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}
