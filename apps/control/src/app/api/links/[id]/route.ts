import { requireSession } from "../../../../server/session";
import { revokeLink, toggleLink } from "../../../../server/links";
import { handleError } from "../../../../server/respond";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireSession(req.headers);
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { status?: string };
    if (body.status === "active" || body.status === "paused") {
      await toggleLink(ctx, id, body.status);
    } else {
      await revokeLink(ctx, id);
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    return handleError(error);
  }
}

export const DELETE = POST;
