import { EmailSchema } from "@chameleon/contracts";
import { auth } from "../../../../server/auth";
import { seeOther } from "../../../../server/respond";
import { currentSession } from "../../../../server/session";
import { withinLimit } from "../../../../server/limit";

export async function POST(req: Request): Promise<Response> {
  const form = Object.fromEntries(await req.formData());
  const email = EmailSchema.safeParse(form.email);
  if (!email.success) return seeOther("/welcome?error=invalid_input");
  if (!(await withinLimit("resend", email.data, 3, 900))) {
    return seeOther("/welcome?error=rate_limited");
  }
  await auth.api.sendVerificationEmail({
    body: { email: email.data, callbackURL: "/welcome" },
  });
  // Logged out (a sign-in attempt that bounced) still needs somewhere to land.
  return (await currentSession())
    ? seeOther("/welcome?sent=1")
    : seeOther("/login?sent=1");
}
