import { EmailSchema } from "@chameleon/contracts";
import { requireSession } from "../../../server/session";
import { addAddress } from "../../../server/forwards";
import { backWithError, seeOther } from "../../../server/respond";

export async function POST(req: Request): Promise<Response> {
  const form = Object.fromEntries(await req.formData());
  const serviceId = typeof form.serviceId === "string" ? form.serviceId : "";
  const back = serviceId ? `/services/${serviceId}#forwarding` : "/services";
  try {
    const ctx = await requireSession(req.headers);
    const email = EmailSchema.parse(form.email);
    await addAddress(ctx, email);
    return seeOther(`${back}?forward_added=1`);
  } catch (error) {
    return backWithError(back, error);
  }
}
