import { LoginSchema } from "@chameleon/contracts";
import { auth } from "../../../server/auth";
import { ensureOrg } from "../../../server/orgs";
import { currentSession } from "../../../server/session";
import { requireDb } from "../../../server/db";
import { backWithError, readBody, seeOther } from "../../../server/respond";

export async function POST(req: Request): Promise<Response> {
  try {
    const input = LoginSchema.parse(await readBody(req));
    const signed = await auth.api.signInEmail({
      body: { email: input.email, password: input.password },
      asResponse: true,
    });
    if (!signed.ok) return seeOther("/login?error=credentials");

    // Repair a signup whose org step died.
    const session = await currentSession(signed.headers);
    if (session && !session.orgId) {
      await ensureOrg(session.userId, session.email.split("@")[0] ?? "org");
    }
    await requireDb()
      .pool.query("select purge_expired_auth()")
      .catch(() => undefined);
    return seeOther("/services", signed.headers);
  } catch (error) {
    return backWithError("/login", error);
  }
}
