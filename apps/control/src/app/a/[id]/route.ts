import { assetBytes } from "../../../server/preview";

/** Immutable cloned assets: the id never changes, so the bytes may be cached hard. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const asset = await assetBytes(id);
  if (!asset) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      "content-type": asset.mime,
      "cache-control": "public, max-age=31536000, immutable",
      "x-robots-tag": "noindex",
    },
  });
}
