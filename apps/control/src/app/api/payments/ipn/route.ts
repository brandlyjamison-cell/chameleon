import { handleIpn } from "../../../../server/billing";
import { handleError, json } from "../../../../server/respond";

/** NowPayments IPN: anonymous, so the signature is the whole authentication. */
export async function POST(req: Request): Promise<Response> {
  try {
    const raw = await req.text();
    const result = await handleIpn(raw, req.headers.get("x-nowpayments-sig"));
    return json({ ok: true, ...result });
  } catch (error) {
    return handleError(error);
  }
}
