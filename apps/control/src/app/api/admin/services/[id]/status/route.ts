import { currentSession } from "../../../../../../server/session";
import { setStatus } from "../../../../../../server/admin";
import { handleError, json } from "../../../../../../server/respond";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const session = await currentSession(req.headers);
    if (!session?.isAdmin) return json({ error: "admin_only" }, 403);
    const { id } = await params;
    const body = (await req.json()) as { status?: string };
    await setStatus(session, id, body.status ?? "active");
    return new Response(null, { status: 204 });
  } catch (error) {
    return handleError(error);
  }
}

export function GET(): Response {
  return json({ ok: true });
}
