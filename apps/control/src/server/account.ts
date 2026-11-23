import "server-only";
import type { Ctx } from "@chameleon/db";
import { orNotFound } from "@chameleon/db";
import { z } from "zod";
import { asTenant } from "./db";
import { invalid } from "./errors";
import { requireOwner } from "./session";

export interface OrgProfile {
  name: string;
  slug: string;
  createdAt: string;
  settings: {
    notifyOnCapture: boolean;
    maskPasswords: boolean;
  };
}

export const OrgSettingsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  notifyOnCapture: z.boolean().default(false),
  maskPasswords: z.boolean().default(false),
});

export async function getOrg(ctx: Ctx): Promise<OrgProfile> {
  return asTenant(ctx, async (c) => {
    const { rows } = await c.query<{
      name: string;
      slug: string;
      created_at: Date;
      settings: Record<string, unknown> | null;
    }>("select name, slug, created_at, settings from orgs where id = $1", [ctx.orgId]);
    const row = orNotFound(rows[0]);
    return {
      name: row.name,
      slug: row.slug,
      createdAt: row.created_at.toISOString(),
      settings: {
        notifyOnCapture: row.settings?.notifyOnCapture === true,
        maskPasswords: row.settings?.maskPasswords === true,
      },
    };
  });
}

export async function updateOrg(
  ctx: Ctx & { userId: string | null },
  input: z.infer<typeof OrgSettingsSchema>,
): Promise<void> {
  requireOwner(ctx);
  const parsed = OrgSettingsSchema.safeParse(input);
  if (!parsed.success) throw invalid("bad_org_settings");
  await asTenant(ctx, async (c) => {
    await c.query(
      `update orgs set name = $2, settings = jsonb_build_object(
         'notifyOnCapture', $3::boolean, 'maskPasswords', $4::boolean)
       where id = $1`,
      [
        ctx.orgId,
        parsed.data.name,
        parsed.data.notifyOnCapture,
        parsed.data.maskPasswords,
      ],
    );
  });
}

export async function organizationName(ctx: Ctx): Promise<string> {
  return asTenant(ctx, async (c) => {
    const { rows } = await c.query<{ name: string }>(
      "select name from orgs where id = $1",
      [ctx.orgId],
    );
    return rows[0]?.name ?? "your organisation";
  });
}
