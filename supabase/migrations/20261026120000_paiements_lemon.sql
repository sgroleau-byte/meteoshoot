-- Paiements Lemon Squeezy, phase 4 (26 octobre 2026).
-- 1. billing_events: chaque événement reçu par le webhook (nom, abonnement, variante, statut, charge utile) pour
--    comprendre un cas bizarre sans fouiller Lemon Squeezy. Table privée: seule la clé de service y écrit et y lit.
-- 2. Profils: nom de la variante souscrite (Fondateur ou Standard) et date de fin si l'abonnement est annulé mais
--    court encore (ends_at), pour l'affichage dans l'app et dans dieu.

create table if not exists public.billing_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  event_name text not null,
  user_id uuid,
  subscription_id text,
  customer_id text,
  variant_id text,
  variant_name text,
  status text,
  test_mode boolean,
  payload jsonb
);
alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated;
create index if not exists billing_events_user_idx on public.billing_events (user_id, received_at desc);

alter table public.user_profiles
  add column if not exists lemon_variant_id text,
  add column if not exists lemon_variant_name text,
  add column if not exists subscription_ends_at timestamptz;
alter table public.user_profiles_dev
  add column if not exists lemon_variant_id text,
  add column if not exists lemon_variant_name text,
  add column if not exists subscription_ends_at timestamptz;

-- La liste des comptes dans dieu montre la variante et la fin d'un abonnement annulé.
drop function if exists public.admin_get_all_users();
create or replace function public.admin_get_all_users()
returns table (
  user_id uuid, email text, created_at timestamptz, confirmed_at timestamptz, last_sign_in_at timestamptz,
  full_name text, organization text, sector text,
  subscription_tier text, subscription_status text, effective_tier text,
  lemon_subscription_id text, lemon_variant_name text, current_period_end timestamptz, subscription_ends_at timestamptz,
  invited_at timestamptz, trial_ends_at timestamptz, is_founder boolean, last_seen_at timestamptz, disabled_at timestamptz,
  notes text, project_count bigint
) language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return query
  select au.id, au.email::text, au.created_at, au.confirmed_at, au.last_sign_in_at,
    up.full_name, up.organization, up.sector,
    up.subscription_tier, up.subscription_status, public.effective_tier(up),
    up.lemon_subscription_id, up.lemon_variant_name, up.current_period_end, up.subscription_ends_at,
    up.invited_at, up.trial_ends_at, up.is_founder, up.last_seen_at, up.disabled_at,
    coalesce(n.notes, ''), coalesce(pc.cnt, 0)
  from auth.users au
  left join public.user_profiles up on up.user_id = au.id
  left join public.admin_notes n on n.user_id = au.id
  left join (select p.user_id, count(*) as cnt from public.projects p group by p.user_id) pc on pc.user_id = au.id
  order by au.created_at desc;
end;
$$;
revoke execute on function public.admin_get_all_users() from public, anon, authenticated;
grant execute on function public.admin_get_all_users() to service_role;
