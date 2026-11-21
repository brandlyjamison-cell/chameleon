import { betterAuth } from "better-auth";
import { passkey } from "@better-auth/passkey";
import { PostgresDialect } from "kysely";
import { randomUUID } from "node:crypto";
import { requireDb } from "./db";
import { button, sendMail, shell } from "./mail";

export const BASE_URL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

const secret = process.env.BETTER_AUTH_SECRET;
if (!secret) throw new Error("BETTER_AUTH_SECRET is required");

export const auth = betterAuth({
  appName: "chameleon",
  baseURL: BASE_URL,
  secret,
  trustedOrigins: [BASE_URL],
  database: {
    dialect: new PostgresDialect({ pool: requireDb().pool }),
    type: "postgres",
  },
  advanced: {
    useSecureCookies: true,
    cookiePrefix: "chameleon",
    database: { generateId: () => randomUUID() },
  },
  // 30-minute idle: the token expires 30 minutes out and is re-issued at most
  // once a minute, so any use inside the window slides it. The 12-hour absolute
  // cap is checked in requireSession, not here.
  session: {
    modelName: "auth_session",
    expiresIn: 60 * 30,
    updateAge: 60,
  },
  account: { modelName: "auth_account" },
  verification: { modelName: "auth_verification" },
  user: {
    modelName: "auth_user",
    changeEmail: { enabled: true },
  },
  emailAndPassword: {
    enabled: true,
    // A session exists before verification, so a service can be created; only
    // activation waits for a verified address (acceptance 1).
    requireEmailVerification: false,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, token }) => {
      const url = `${BASE_URL}/api/auth/verify-email?token=${token}&callbackURL=/welcome`;
      console.log(`[mail] verify ${user.email}: ${url}`);
      await sendMail({
        to: user.email,
        subject: "Confirm your Chameleon address",
        text: `Confirm ${user.email} to finish setting up Chameleon:
${url}

The link is good for 24 hours.`,
        html: shell(
          "Confirm your address",
          `<p style="margin:0 0 18px;color:#b6c2cf">One click and ${user.email} stops being provisional. The link is good for 24 hours.</p>${button(url, "Confirm address")}`,
        ),
      });
    },
  },
  plugins: [
    passkey({
      rpID: new URL(BASE_URL).hostname,
      rpName: "Chameleon",
      origin: BASE_URL,
    }),
  ],
  databaseHooks: {
    // `users` is the tenant-facing mirror memberships point at. The hook is
    // idempotent so a retried signup cannot double it.
    user: {
      create: {
        after: async (user) => {
          await requireDb().pool.query(
            `insert into users (id, email, name) values ($1, $2, $3)
             on conflict (id) do update set email = excluded.email`,
            [user.id, user.email, user.name],
          );
        },
      },
    },
  },
});

export type Auth = typeof auth;
