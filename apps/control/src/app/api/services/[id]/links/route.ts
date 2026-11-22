import { requireSession } from "../../../../../server/session";
import { mintLink, listLinks } from "../../../../../server/links";
import { handleError } from "../../../../../server/respond";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireSession(req.headers);
    const { id } = await params;
    return Response.json(await listLinks(ctx, id), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const ctx = await requireSession(req.headers);
    const { id } = await params;
    const body = (await req.json()) as { hostnameId?: string; brandId?: string };
    const link = await mintLink(ctx, id, {
      hostnameId: body.hostnameId ?? "",
      brandId: body.brandId ?? "",
    });
    return Response.json(link, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
