import { DomainSchema } from "@chameleon/contracts";
import { listOrgDomains, requestDomain } from "../../../server/domains";
import { requireSession } from "../../../server/session";
import { handleError, json, readBody } from "../../../server/respond";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireSession(req.headers);
    return json(await listOrgDomains(ctx));
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const ctx = await requireSession(req.headers);
    const { root } = DomainSchema.parse(await readBody(req));
    return json(await requestDomain(ctx, root), 201);
  } catch (error) {
    return handleError(error);
  }
}
