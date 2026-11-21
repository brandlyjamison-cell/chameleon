import { seeOther } from "../../../../server/respond";
import { verifyForward } from "../../../../server/forwards";

/** Opened from a mail client, so no session and no body: the token is the proof. */
export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const org = await verifyForward(token);
  return seeOther(org ? "/services?forward=verified" : "/services?forward=invalid");
}
