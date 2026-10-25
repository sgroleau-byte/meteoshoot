-- Comptes sur invitation et tableau de bord « dieu » (25 octobre 2026).
-- 1. Liste des administrateurs (table privée) et vérification « Face ID exigé »: dès que l'administrateur a une clé
--    d'accès (passkey WebAuthn) vérifiée, toutes les fonctions admin exigent une session de niveau aal2.
-- 2. Profils: invitation (quand, par qui), fin de la période gratuite, fondateur (prix garanti), dernière visite,
--    désactivation. Les droits par colonne du 26 septembre 2026 restent: le client ne peut écrire que son nom, son
--    organisation et son secteur; tout le reste passe par le serveur.
-- 3. Notes privées de l'admin et journal des actions (tables privées, jamais lues par le client).
-- 4. Réglages de l'application (ce que garde un compte gratuit, défauts d'invitation): lecture pour les utilisateurs
--    connectés, écriture par l'admin seulement.
-- 5. Palier effectif: complet si l'abonnement est actif OU si la gratuité court encore; sinon gratuit.
-- 6. Fonctions admin réécrites (liste, statistiques, mise à jour d'un compte, réglages, journal) et « dernière visite ».

-- ===== 1. Administrateurs et niveau de session =====
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;
insert into public.admins (user_id)
  select id from auth.users where email = 'sgroleau@me.com'
  on conflict do nothing;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- Vrai si la session est de niveau aal2 (Face ID, Touch ID ou autre second facteur vérifié), ou si l'utilisateur
-- n'a encore aucun facteur vérifié (premier accès: la page dieu force alors l'enregistrement d'une clé d'accès).
create or replace function public.mfa_satisfied()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified');
$$;

create or replace function public.assert_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.mfa_satisfied() then
    raise exception 'MFA required' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.is_admin(), public.mfa_satisfied(), public.assert_admin() from public, anon;
grant execute on function public.is_admin(), public.mfa_satisfied() to authenticated;

-- ===== 2. Colonnes d'invitation sur les profils =====
alter table public.user_profiles
  add column if not exists invited_at    timestamptz,
  add column if not exists invited_by    uuid,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists is_founder    boolean not null default false,
  add column if not exists last_seen_at  timestamptz,
  add column if not exists disabled_at   timestamptz;
alter table public.user_profiles_dev
  add column if not exists invited_at    timestamptz,
  add column if not exists invited_by    uuid,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists is_founder    boolean not null default false,
  add column if not exists last_seen_at  timestamptz,
  add column if not exists disabled_at   timestamptz;

-- ===== 3. Notes privées et journal =====
create table if not exists public.admin_notes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notes text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.admin_notes enable row level security;
revoke all on public.admin_notes from anon, authenticated;

create table if not exists public.admin_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  admin_id uuid,
  action text not null,
  target_user_id uuid,
  target_email text,
  details jsonb
);
alter table public.admin_log enable row level security;
revoke all on public.admin_log from anon, authenticated;

create or replace function public.admin_log_write(p_action text, p_target uuid, p_details jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.admin_log (admin_id, action, target_user_id, target_email, details)
  values (auth.uid(), p_action, p_target, (select email from auth.users where id = p_target), p_details);
end;
$$;
revoke execute on function public.admin_log_write(text, uuid, jsonb) from public, anon, authenticated;

-- ===== 4. Réglages de l'application =====
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated using (true);

insert into public.app_settings (key, value) values
  ('free_limits',     '{"maxProjects": 3, "scene3d": false, "forecastDays": 3}'::jsonb),
  ('invite_defaults', '{"trialDays": 90, "founderSeats": 50, "founderPrice": "12,99 $ par mois"}'::jsonb)
on conflict (key) do nothing;

-- ===== 5. Palier effectif (colonne calculée lisible par PostgREST: select('*, effective_tier')) =====
create or replace function public.effective_tier(p public.user_profiles)
returns text language sql stable as $$
  select case
    when p.disabled_at is not null then 'disabled'
    when p.subscription_tier in ('shooter', 'god') and p.subscription_status in ('active', 'past_due') then p.subscription_tier
    when p.trial_ends_at is not null and p.trial_ends_at > now() then 'shooter'
    else 'free'
  end;
$$;
create or replace function public.effective_tier(p public.user_profiles_dev)
returns text language sql stable as $$
  select case
    when p.disabled_at is not null then 'disabled'
    when p.subscription_tier in ('shooter', 'god') and p.subscription_status in ('active', 'past_due') then p.subscription_tier
    when p.trial_ends_at is not null and p.trial_ends_at > now() then 'shooter'
    else 'free'
  end;
$$;

-- ===== 6. Fonctions admin =====
drop function if exists public.admin_get_all_users();
create or replace function public.admin_get_all_users()
returns table (
  user_id uuid, email text, created_at timestamptz, confirmed_at timestamptz, last_sign_in_at timestamptz,
  full_name text, organization text, sector text,
  subscription_tier text, subscription_status text, effective_tier text,
  lemon_subscription_id text, current_period_end timestamptz,
  invited_at timestamptz, trial_ends_at timestamptz, is_founder boolean, last_seen_at timestamptz, disabled_at timestamptz,
  notes text, project_count bigint
) language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return query
  select au.id, au.email::text, au.created_at, au.confirmed_at, au.last_sign_in_at,
    up.full_name, up.organization, up.sector,
    up.subscription_tier, up.subscription_status, public.effective_tier(up),
    up.lemon_subscription_id, up.current_period_end,
    up.invited_at, up.trial_ends_at, up.is_founder, up.last_seen_at, up.disabled_at,
    coalesce(n.notes, ''), coalesce(pc.cnt, 0)
  from auth.users au
  left join public.user_profiles up on up.user_id = au.id
  left join public.admin_notes n on n.user_id = au.id
  left join (select p.user_id, count(*) as cnt from public.projects p group by p.user_id) pc on pc.user_id = au.id
  order by au.created_at desc;
end;
$$;

create or replace function public.admin_get_stats()
returns json language plpgsql security definer set search_path = public as $$
declare result json;
begin
  perform public.assert_admin();
  select json_build_object(
    'total_users',   (select count(*) from auth.users),
    'total_projects',(select count(*) from public.projects),
    'invited_pending', (select count(*) from auth.users au where au.invited_at is not null and au.last_sign_in_at is null),
    'trials_active', (select count(*) from public.user_profiles p where p.disabled_at is null and p.trial_ends_at > now()
                        and not (p.subscription_tier in ('shooter','god') and p.subscription_status in ('active','past_due'))),
    'trials_expired',(select count(*) from public.user_profiles p where p.disabled_at is null and p.trial_ends_at <= now()
                        and not (p.subscription_tier in ('shooter','god') and p.subscription_status in ('active','past_due'))),
    'paid',          (select count(*) from public.user_profiles p where p.subscription_tier in ('shooter','god') and p.subscription_status in ('active','past_due')),
    'founders',      (select count(*) from public.user_profiles p where p.is_founder),
    'disabled',      (select count(*) from public.user_profiles p where p.disabled_at is not null),
    'users_by_tier', (select json_object_agg(subscription_tier, cnt) from (select subscription_tier, count(*) as cnt from public.user_profiles group by subscription_tier) t),
    'users_by_sector', (select json_object_agg(coalesce(sector, 'N/A'), cnt) from (select sector, count(*) as cnt from public.user_profiles group by sector) t)
  ) into result;
  return result;
end;
$$;

-- Mise à jour d'un compte par l'admin. Le patch peut contenir: trial_ends_at (date ou null), is_founder (bool),
-- subscription_tier (free | shooter | god), notes (texte), disabled (bool). Les deux tables (prod et dev) suivent.
create or replace function public.admin_update_user(target_user_id uuid, patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tier text;
begin
  perform public.assert_admin();
  if target_user_id is null or not exists (select 1 from auth.users where id = target_user_id) then
    raise exception 'Utilisateur inconnu';
  end if;

  if patch ? 'trial_ends_at' then
    update public.user_profiles     set trial_ends_at = nullif(patch ->> 'trial_ends_at', '')::timestamptz where user_id = target_user_id;
    update public.user_profiles_dev set trial_ends_at = nullif(patch ->> 'trial_ends_at', '')::timestamptz where user_id = target_user_id;
  end if;
  if patch ? 'is_founder' then
    update public.user_profiles     set is_founder = (patch ->> 'is_founder')::boolean where user_id = target_user_id;
    update public.user_profiles_dev set is_founder = (patch ->> 'is_founder')::boolean where user_id = target_user_id;
  end if;
  if patch ? 'subscription_tier' then
    v_tier := patch ->> 'subscription_tier';
    if v_tier not in ('free', 'shooter', 'god') then raise exception 'Palier invalide'; end if;
    update public.user_profiles     set subscription_tier = v_tier, subscription_status = 'active' where user_id = target_user_id;
    update public.user_profiles_dev set subscription_tier = v_tier, subscription_status = 'active' where user_id = target_user_id;
  end if;
  if patch ? 'disabled' then
    update public.user_profiles     set disabled_at = case when (patch ->> 'disabled')::boolean then now() else null end where user_id = target_user_id;
    update public.user_profiles_dev set disabled_at = case when (patch ->> 'disabled')::boolean then now() else null end where user_id = target_user_id;
  end if;
  if patch ? 'notes' then
    insert into public.admin_notes (user_id, notes, updated_at) values (target_user_id, coalesce(patch ->> 'notes', ''), now())
    on conflict (user_id) do update set notes = excluded.notes, updated_at = now();
  end if;

  perform public.admin_log_write('update', target_user_id, patch - 'notes');
end;
$$;

-- Ancienne fonction gardée pour compatibilité, désormais soumise aux mêmes vérifications.
create or replace function public.admin_set_tier(target_user_id uuid, new_tier text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.admin_update_user(target_user_id, jsonb_build_object('subscription_tier', new_tier));
end;
$$;

create or replace function public.admin_set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if p_key not in ('free_limits', 'invite_defaults') then raise exception 'Réglage inconnu'; end if;
  insert into public.app_settings (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.admin_log_write('setting', null, jsonb_build_object('key', p_key, 'value', p_value));
end;
$$;

create or replace function public.admin_get_log(p_limit int default 100)
returns table (id bigint, at timestamptz, admin_id uuid, action text, target_user_id uuid, target_email text, details jsonb)
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return query select l.id, l.at, l.admin_id, l.action, l.target_user_id, l.target_email, l.details
    from public.admin_log l order by l.at desc limit least(coalesce(p_limit, 100), 500);
end;
$$;

-- Dernière visite: l'application l'appelle au démarrage; au plus une écriture par heure.
create or replace function public.touch_last_seen()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  update public.user_profiles     set last_seen_at = now() where user_id = auth.uid() and (last_seen_at is null or last_seen_at < now() - interval '1 hour');
  update public.user_profiles_dev set last_seen_at = now() where user_id = auth.uid() and (last_seen_at is null or last_seen_at < now() - interval '1 hour');
end;
$$;

revoke execute on function
  public.admin_get_all_users(), public.admin_get_stats(), public.admin_update_user(uuid, jsonb),
  public.admin_set_tier(uuid, text), public.admin_set_setting(text, jsonb), public.admin_get_log(int), public.touch_last_seen()
from public, anon;
grant execute on function
  public.admin_get_all_users(), public.admin_get_stats(), public.admin_update_user(uuid, jsonb),
  public.admin_set_tier(uuid, text), public.admin_set_setting(text, jsonb), public.admin_get_log(int), public.touch_last_seen()
to authenticated;
