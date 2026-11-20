#!/usr/bin/env node
/**
 * INV-DATA-01 gate: every table with an org_id must have RLS enabled, forced,
 * and at least one policy. Fails the gate, not review.
 */
import pg from "pg";

const url = process.env.DATABASE_URL_MIGRATOR ?? process.env.DATABASE_URL_TEST;
if (!url) throw new Error("DATABASE_URL_MIGRATOR or DATABASE_URL_TEST required");

const client = new pg.Client({ connectionString: url });
await client.connect();

const { rows } = await client.query(`
  select c.relname as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
         (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and exists (
      select 1 from information_schema.columns col
      where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'org_id'
    )
  order by c.relname
`);

const bad = rows.filter((r) => !r.enabled || !r.forced || Number(r.policies) === 0);
await client.end();

if (bad.length > 0) {
  process.stdout.write(
    `tenant tables without forced RLS:\n${bad
      .map(
        (r) =>
          `  ${r.name} enabled=${r.enabled} forced=${r.forced} policies=${r.policies}`,
      )
      .join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write(`${rows.length} tenant tables forced and policied\n`);
