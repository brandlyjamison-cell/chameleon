-- 0027_admin_tenants.sql — the operator panel is tenant-first: find a tenant,
-- open it, then act. All reads are definer functions because the operator has no
-- tenant GUC.

create or replace function admin_tenants(p_q text default null)
returns table (
  org_id uuid, org_name text, owner_email text, created_at timestamptz,
  services bigint, captures bigint, domains bigint, hostnames bigint, last_seen timestamptz
)
language sql security definer set search_path = public stable as $$
  select o.id, o.name, u.email, o.created_at,
         (select count(*) from services s where s.org_id = o.id),
         (select count(*) from captures c where c.org_id = o.id),
         (select count(*) from org_domains d where d.org_id = o.id and d.deleted_at is null),
         (select count(*) from hostnames h where h.org_id = o.id and h.deleted_at is null),
         greatest(
           (select max(s.created_at) from services s where s.org_id = o.id),
           (select max(c.received_at) from captures c where c.org_id = o.id),
           o.created_at
         )
  from orgs o
  left join memberships m on m.org_id = o.id and m.role = 'owner'
  left join users u on u.id = m.user_id
  where p_q is null or p_q = ''
     or o.name ilike '%' || p_q || '%'
     or u.email ilike '%' || p_q || '%'
     or o.id::text = p_q
  order by o.created_at desc
  limit 100
$$;

/**
 * One tenant, everything an operator needs in a single call: services, domains,
 * hostnames, forwarding and the audit tail.
 */
create or replace function admin_org_detail(p_org uuid)
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'org', jsonb_build_object(
      'id', o.id, 'name', o.name, 'createdAt', o.created_at,
      'notifyEmail', o.notify_email, 'notifyEnabled', o.notify_enabled,
      'notifyVerifiedAt', o.notify_verified_at
    ),
    'owner', (select u.email from memberships m join users u on u.id = m.user_id
               where m.org_id = o.id and m.role = 'owner' limit 1),
    'services', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'status', s.status, 'tier', t.code,
        'previewKey', s.preview_key, 'linkCap', t.link_cap,
        'hostnameCap', t.hostname_cap, 'linksUsed', s.link_slots_used,
        'hostnamesUsed', s.hostname_slots_used, 'paidUntil', s.paid_until,
        'expiresAt', s.expires_at, 'createdAt', s.created_at)
        order by s.created_at desc)
      from services s join tiers t on t.id = s.tier_id where s.org_id = o.id), '[]'::jsonb),
    'domains', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'root', d.root, 'status', d.status,
        'routingState', d.routing_state, 'createdAt', d.created_at)
        order by d.created_at desc)
      from org_domains d where d.org_id = o.id and d.deleted_at is null), '[]'::jsonb),
    'hostnames', coalesce((select jsonb_agg(jsonb_build_object(
        'id', h.id, 'fqdn', h.fqdn, 'status', h.status,
        'serviceName', s.name, 'createdAt', h.created_at)
        order by h.created_at desc)
      from hostnames h join services s on s.id = h.service_id
      where h.org_id = o.id and h.deleted_at is null), '[]'::jsonb),
    'forwards', coalesce((select jsonb_agg(jsonb_build_object(
        'id', f.id, 'email', f.email, 'status', f.status, 'createdAt', f.created_at)
        order by f.created_at desc)
      from forward_addresses f where f.org_id = o.id), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'action', a.action, 'targetId', a.target_id,
        'detail', a.after, 'createdAt', a.created_at) order by a.created_at desc)
      from (select * from audit_log where org_id = o.id
             order by created_at desc limit 20) a), '[]'::jsonb)
  )
  from orgs o where o.id = p_org
$$;

alter function admin_tenants(text) owner to app_admin;
alter function admin_org_detail(uuid) owner to app_admin;
grant execute on function admin_tenants(text) to app_rw;
grant execute on function admin_org_detail(uuid) to app_rw;
