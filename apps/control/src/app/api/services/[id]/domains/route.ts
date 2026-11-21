import { DomainSchema } from "@chameleon/contracts";
import { listDomains, requestDomain } from "../../../../../server/domains";
import { requireSession } from "../../../../../server/session";
import { handleError, json, readBody } from "../../../../../server/respond";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await requireSession(req.headers);
    return json(await listDomains(ctx, id));
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await requireSession(req.headers);
    const { hostname } = DomainSchema.parse(await readBody(req));
    return json(await requestDomain(ctx, id, hostname), 201);
  } catch (error) {
    return handleError(error);
  }
}
