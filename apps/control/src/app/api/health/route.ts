import { requireDb } from "../../../server/db";
import { mailLimits } from "../../../server/mail";
import { mailStats, quotaSpent, warnIfStale } from "../../../server/mailqueue";

export const dynamic = "force-dynamic";

/** Real dependency check, not a static 200. Backlog and quota are reported, not fatal. */
export async function GET(): Promise<Response> {
  try {
    await requireDb().pool.query("select 1");
    const mail = await mailStats();
    const quota = await mailLimits();
    warnIfStale(mail, quota);
    return Response.json(
      {
        ok: true,
        db: true,
        mail: { ...mail, parked: quotaSpent(quota) },
        quota: quota
          ? {
              sent: quota.sent,
              limit: quota.quota,
              overQuota: quota.overQuota,
              resetsAt: quota.resetsAt,
            }
          : null,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { ok: false, db: false, error: (error as Error).message },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
