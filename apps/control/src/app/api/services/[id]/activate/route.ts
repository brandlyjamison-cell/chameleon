import { ActivateSchema } from "@chameleon/contracts";
import { activateIn } from "../../../../../server/services";
import { requireSession } from "../../../../../server/session";
import { backWithError, readBody, seeOther } from "../../../../../server/respond";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const ctx = await requireSession(req.headers);
    const input = ActivateSchema.parse(await readBody(req));
    await activateIn(ctx, id, input);
    return seeOther(`/services/${id}?activated=1`);
  } catch (error) {
    return backWithError(`/services/${id}`, error);
  }
}
