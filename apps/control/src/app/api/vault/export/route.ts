import { requireSession } from "../../../../server/session";
import { exportCsv } from "../../../../server/vault";
import { handleError } from "../../../../server/respond";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const ctx = await requireSession(req.headers);
    const url = new URL(req.url);
    const csv = await exportCsv(ctx, {
      ...(url.searchParams.get("service")
        ? { serviceId: url.searchParams.get("service")! }
        : {}),
      ...(url.searchParams.get("status")
        ? { status: url.searchParams.get("status")! }
        : {}),
      ...(url.searchParams.get("source")
        ? { source: url.searchParams.get("source")! }
        : {}),
      ...(url.searchParams.get("q") ? { q: url.searchParams.get("q")! } : {}),
    });
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="captures-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
