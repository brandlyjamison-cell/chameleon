import { timingSafeEqual } from "node:crypto";
import { drain } from "../../../../server/mailqueue";
import { handleError, json } from "../../../../server/respond";

/** Driven by a 30-second systemd timer; token-gated like the domain job. */
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
    return json(await drain(50));
  } catch (error) {
    return handleError(error);
  }
}
