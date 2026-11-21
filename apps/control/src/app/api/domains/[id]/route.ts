import { removeDomain } from "../../../../server/domains";
import { requireSession } from "../../../../server/session";
import { handleError } from "../../../../server/respond";

/** HTML forms cannot DELETE; the detail page posts here instead. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await requireSession(req.headers);
    await removeDomain(ctx, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return handleError(error);
  }
}

export const DELETE = POST;
