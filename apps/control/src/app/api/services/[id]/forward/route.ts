import { requireSession } from "../../../../../server/session";
import { queueLatestCapture } from "../../../../../server/forwards";
import { backWithError, seeOther } from "../../../../../server/respond";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const ctx = await requireSession(req.headers);
    const form = await req.formData();
    await queueLatestCapture(ctx, id, String(form.get("addressId") ?? ""));
    return seeOther(`/services/${id}?forwarded=1#forwarding`);
  } catch (error) {
    return backWithError(`/services/${id}`, error);
  }
}
