import { checkout } from "../../../../../server/billing";
import { requireSession } from "../../../../../server/session";
import { backWithError, seeOther } from "../../../../../server/respond";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  try {
    const ctx = await requireSession(req.headers);
    const payment = await checkout(ctx, id);
    return seeOther(payment.checkoutUrl ?? `/services/${id}?error=billing_off`);
  } catch (error) {
    return backWithError(`/services/${id}`, error);
  }
}
