import { SignupSchema } from "@chameleon/contracts";
import { auth } from "../../../server/auth";
import { ensureOrg } from "../../../server/orgs";
import { backWithError, json, readBody, seeOther } from "../../../server/respond";
import { clientIp, withinLimit } from "../../../server/limit";

export async function POST(req: Request): Promise<Response> {
  try {
    if (!(await withinLimit("signup", clientIp(req.headers), 30, 3600))) {
      return seeOther("/signup?error=rate_limited");
    }
    const input = SignupSchema.parse(await readBody(req));
    const created = await auth.api.signUpEmail({
      body: { name: input.name, email: input.email, password: input.password },
      asResponse: true,
    });
    if (!created.ok) return created;

    const body = (await created.clone().json()) as { user: { id: string } };
    // Org provisioning is resumable and runs after the user exists, so a failure
    // here is repaired on the next sign-in rather than losing the account.
    await ensureOrg(body.user.id, input.orgName);
    return seeOther("/welcome", created.headers);
  } catch (error) {
    return backWithError("/signup", error);
  }
}

/** A bare GET is useful for uptime probes and debugging. */
export function GET(): Response {
  return json(
    { ok: true, endpoint: "signup", method: "POST" },
    200,
    new Headers({
      allow: "POST",
    }),
  );
}
