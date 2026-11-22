import { requireDb } from "../../../server/db";
import { mailStats, warnIfStale } from "../../../server/mailqueue";

export const dynamic = "force-dynamic";

/** Real dependency check, not a static 200. Backlog is reported, not fatal. */
export async function GET(): Promise<Response> {
  try {
    await requireDb().pool.query("select 1");
    const mail = await mailStats();
    warnIfStale(mail);
    return Response.json(
      { ok: true, db: true, mail },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, db: false, error: (error as Error).message },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
