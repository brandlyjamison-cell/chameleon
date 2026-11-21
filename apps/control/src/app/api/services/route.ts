import { CreateServiceSchema } from "@chameleon/contracts";
import { createService, listServices } from "../../../server/services";
import { requireSession } from "../../../server/session";
import {
  backWithError,
  handleError,
  json,
  readBody,
  seeOther,
} from "../../../server/respond";

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireSession(req.headers);
    const input = CreateServiceSchema.parse(await readBody(req));
    const view = await createService(ctx, { ...input, tier: input.tier });
    return seeOther(`/services/${view.id}`);
  } catch (error) {
    return backWithError("/services/new", error);
  }
}

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireSession(req.headers);
    return json(await listServices(ctx));
  } catch (error) {
    return handleError(error);
  }
}
