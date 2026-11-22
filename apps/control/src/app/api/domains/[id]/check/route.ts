import { checkDomain } from "../../../../../server/domains";
import { requireSession } from "../../../../../server/session";
import { handleError, json } from "../../../../../server/respond";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const form = (req.headers.get("content-type") ?? "").includes("form")
      ? await req.formData()
      : null;
    const ctx = await requireSession(req.headers);
    const row = await checkDomain(ctx, id);
    // A plain form post wants a page back, not JSON. The console's own copy
    // buttons use fetch and keep the JSON.
    if (req.headers.get("accept")?.includes("text/html")) {
      const asked = String(form?.get("returnTo") ?? "/settings/domains");
      const back = asked.startsWith("/") ? asked : "/settings/domains";
      return new Response(null, { status: 303, headers: { location: back } });
    }
    return json(row);
  } catch (error) {
    return handleError(error);
  }
}
