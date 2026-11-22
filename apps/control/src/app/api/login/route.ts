import { LoginSchema } from "@chameleon/contracts";
import { auth } from "../../../server/auth";
import { ensureOrg } from "../../../server/orgs";
import { currentSession } from "../../../server/session";
import { requireDb } from "../../../server/db";
import { backWithError, readBody, seeOther } from "../../../server/respond";
import { clientIp, withinLimit } from "../../../server/limit";

export async function POST(req: Request): Promise<Response> {
  try {
    const input = LoginSchema.parse(await readBody(req));
    if (
      !(await withinLimit("login", `${clientIp(req.headers)}|${input.email}`, 10, 600))
    ) {
      return seeOther("/login?error=rate_limited");
    }
    const signed = await auth.api.signInEmail({
      body: { email: input.email, password: input.password },
      asResponse: true,
    });
    if (!signed.ok) {
      // Say "unverified" instead of "wrong password" when that is the real cause.
      const { rows } = await requireDb().pool.query<{ verified: boolean }>(
        `select "emailVerified" as verified from auth_user where lower(email) = lower($1) limit 1`,
        [input.email],
      );
      return seeOther(
        rows[0] && !rows[0].verified
          ? "/login?error=unverified"
          : "/login?error=credentials",
      );
    }

    // Repair a signup whose org step died.
    const session = await currentSession(signed.headers);
    if (session && !session.orgId) {
      await ensureOrg(session.userId, session.email.split("@")[0] ?? "org");
    }
    await requireDb()
      .pool.query("select purge_expired_auth()")
      .catch(() => undefined);
    return seeOther("/dashboard", signed.headers);
  } catch (error) {
    return backWithError("/login", error);
  }
}
