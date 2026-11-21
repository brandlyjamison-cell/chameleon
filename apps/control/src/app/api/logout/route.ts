import { auth } from "../../../server/auth";
import { seeOther } from "../../../server/respond";

export async function POST(req: Request): Promise<Response> {
  const out = await auth.api.signOut({ headers: req.headers, asResponse: true });
  return seeOther("/login", out.headers);
}
