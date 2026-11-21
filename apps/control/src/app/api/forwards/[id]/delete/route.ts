import { requireSession } from "../../../../../server/session";
import { removeAddress } from "../../../../../server/forwards";
import { backWithError, seeOther } from "../../../../../server/respond";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const ctx = await requireSession(req.headers);
    await removeAddress(ctx, id);
    return seeOther("/services?forward_removed=1");
  } catch (error) {
    return backWithError("/services", error);
  }
}
