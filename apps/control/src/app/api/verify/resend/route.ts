import { EmailSchema } from "@chameleon/contracts";
import { auth } from "../../../../server/auth";
import { seeOther } from "../../../../server/respond";

export async function POST(req: Request): Promise<Response> {
  const form = Object.fromEntries(await req.formData());
  const email = EmailSchema.safeParse(form.email);
  if (!email.success) return seeOther("/welcome?error=invalid_input");
  await auth.api.sendVerificationEmail({
    body: { email: email.data, callbackURL: "/welcome" },
  });
  return seeOther("/welcome?sent=1");
}
