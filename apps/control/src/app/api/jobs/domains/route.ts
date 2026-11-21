import { timingSafeEqual } from "node:crypto";
import { runJob } from "../../../../server/domains";
import { handleError, json } from "../../../../server/respond";

/**
 * Called by a systemd timer, not a browser: the shared token is compared in
 * constant time and the route is POST-only so a crawler cannot burn a run.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const expected = process.env.JOBS_TOKEN;
    const given = req.headers.get("x-job-token") ?? "";
    if (!expected) return json({ error: "jobs_disabled" }, 503);
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return json({ error: "forbidden" }, 403);
    }
    return json(await runJob());
  } catch (error) {
    return handleError(error);
  }
}
