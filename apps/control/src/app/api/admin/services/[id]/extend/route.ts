import { currentSession } from "../../../../../../server/session";
import { extendDays } from "../../../../../../server/admin";
import { handleError, json } from "../../../../../../server/respond";

/** Comp days. The audit row is written by the server function, not here. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await currentSession(req.headers);
    if (!session?.isAdmin) return json({ error: "admin_only" }, 403);
    const { id } = await params;
    const body = (await req.json()) as { days?: number };
    const days = Number(body.days ?? 0);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return json({ error: "bad_days" }, 422);
    }
    await extendDays(session, id, days);
    return new Response(null, { status: 204 });
  } catch (error) {
    return handleError(error);
  }
}
