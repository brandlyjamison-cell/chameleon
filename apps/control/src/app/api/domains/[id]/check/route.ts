import { checkDomain } from "../../../../../server/domains";
import { requireSession } from "../../../../../server/session";
import { handleError, json } from "../../../../../server/respond";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await requireSession(req.headers);
    return json(await checkDomain(ctx, id));
  } catch (error) {
    return handleError(error);
  }
}
