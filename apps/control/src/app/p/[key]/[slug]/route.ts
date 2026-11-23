import { notFoundResponse } from "@chameleon/contracts";
import { capture, page, resolve } from "../../../../server/preview";

/** Preview links are always on the platform host, so they never depend on DNS. */
export const dynamic = "force-dynamic";

const HTML = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ key: string; slug: string }> },
): Promise<Response> {
  const { key, slug } = await params;
  const target = await resolve(key, slug);
  if (!target) return notFoundResponse();

  const url = new URL(req.url);
  const step = url.searchParams.get("step") === "2" ? 2 : 1;
  const email = url.searchParams.get("email");
  return new Response(await page(target, { step, email }), { headers: HTML });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ key: string; slug: string }> },
): Promise<Response> {
  const { key, slug } = await params;
  const target = await resolve(key, slug);
  if (!target) return notFoundResponse();

  const form: Record<string, string> = {};
  for (const [name, value] of (await req.formData()).entries()) {
    if (typeof value === "string") form[name] = value;
  }

  // A two-step brand: the email step comes back as the password step.
  if (target.row.step_count === 2 && form.step !== "2") {
    const email = form.email ?? null;
    const next = await page(target, { step: 2, email });
    return new Response(next, { headers: HTML });
  }

  const done = await capture(target, form);
  return new Response(null, {
    status: 303,
    headers: { location: done.redirectTo, "cache-control": "no-store" },
  });
}
