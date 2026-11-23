import { HostnameSchema } from "@chameleon/contracts";
import { addHostname, listHostnames } from "../../../../../server/domains";
import { requireSession } from "../../../../../server/session";
import { handleError, json, readBody } from "../../../../../server/respond";

/** Hostnames a service consumes; the domain is account-wide. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await requireSession(req.headers);
    return json(await listHostnames(ctx, id));
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
    const input = HostnameSchema.parse(await readBody(req));
    return json(await addHostname(ctx, id, input), 201);
  } catch (error) {
    return handleError(error);
  }
}
