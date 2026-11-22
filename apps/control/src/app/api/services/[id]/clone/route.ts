import { cloneLogin } from "../../../../../server/clone";
import { requireSession } from "../../../../../server/session";
import { handleError, json, readBody } from "../../../../../server/respond";

/** API parity with the service page form. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await requireSession(req.headers);
    const body = (await readBody(req)) as { url?: string };
    return json(await cloneLogin(ctx, id, body.url ?? ""), 201);
  } catch (error) {
    return handleError(error);
  }
}
