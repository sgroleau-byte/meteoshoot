-- Suite aux avis de sécurité Supabase (25 octobre 2026):
-- 1. Les fonctions admin ne sont plus exécutables par les utilisateurs connectés: la page dieu passe entièrement par la
--    fonction edge admin-users (clé de service). Seul le rôle de service peut les appeler. assert_admin garde la
--    vérification admin + clé d'accès pour le cas où elles seraient appelées autrement.
-- 2. handle_new_user (déclencheur) n'a pas à être appelable par anon ou authenticated.
-- 3. effective_tier: search_path fixé.
-- 4. mfa_satisfied (second facteur WebAuthn, non disponible sur ce projet) retirée.

revoke execute on function
  public.admin_get_all_users(), public.admin_get_stats(), public.admin_get_log(int),
  public.admin_update_user(uuid, jsonb, uuid), public.admin_set_tier(uuid, text), public.admin_set_setting(text, jsonb, uuid),
  public.admin_set_passkey_required(uuid, boolean), public.assert_admin(), public.is_admin(), public.passkey_satisfied(),
  public.admin_log_write(text, uuid, jsonb, uuid)
from public, anon, authenticated;
grant execute on function
  public.admin_get_all_users(), public.admin_get_stats(), public.admin_get_log(int),
  public.admin_update_user(uuid, jsonb, uuid), public.admin_set_tier(uuid, text), public.admin_set_setting(text, jsonb, uuid),
  public.admin_set_passkey_required(uuid, boolean), public.assert_admin(), public.is_admin(), public.passkey_satisfied(),
  public.admin_log_write(text, uuid, jsonb, uuid)
to service_role;

drop function if exists public.mfa_satisfied();

revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

create or replace function public.effective_tier(p public.user_profiles)
returns text language sql stable set search_path = public as $$
  select case
    when p.disabled_at is not null then 'disabled'
    when p.subscription_tier in ('shooter', 'god') and p.subscription_status in ('active', 'past_due') then p.subscription_tier
    when p.trial_ends_at is not null and p.trial_ends_at > now() then 'shooter'
    else 'free'
  end;
$$;
create or replace function public.effective_tier(p public.user_profiles_dev)
returns text language sql stable set search_path = public as $$
  select case
    when p.disabled_at is not null then 'disabled'
    when p.subscription_tier in ('shooter', 'god') and p.subscription_status in ('active', 'past_due') then p.subscription_tier
    when p.trial_ends_at is not null and p.trial_ends_at > now() then 'shooter'
    else 'free'
  end;
$$;
