-- Page dieu, suite (25 octobre 2026). Supabase n'offre pas WebAuthn comme second facteur sur ce projet (l'API de
-- gestion refuse), mais offre les clés d'accès (passkeys: Face ID, Touch ID) comme méthode de connexion. Donc:
-- 1. admins.passkey_required: dès que l'admin a enregistré une clé d'accès, la fonction edge admin-users exige une
--    session ouverte par clé d'accès (méthode « passkey » dans la liste amr du jeton). Le même critère est appliqué ici
--    pour les appels directs des fonctions SQL par un jeton d'admin.
-- 2. La fonction edge appelle ces fonctions SQL avec la clé de service: assert_admin accepte ce rôle, et l'auteur des
--    actions est alors passé explicitement (p_actor) pour le journal.

alter table public.admins add column if not exists passkey_required boolean not null default false;

create or replace function public.passkey_satisfied()
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.admins a where a.user_id = auth.uid() and a.passkey_required)
      or exists (
        select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) m
        where m ->> 'method' in ('passkey', 'webauthn', 'mfa/webauthn')
      );
$$;

create or replace function public.assert_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role' then
    return;
  end if;
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if not public.passkey_satisfied() then
    raise exception 'Passkey required' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.passkey_satisfied(), public.assert_admin() from public, anon;
grant execute on function public.passkey_satisfied() to authenticated;

create or replace function public.admin_log_write(p_action text, p_target uuid, p_details jsonb default null, p_actor uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.admin_log (admin_id, action, target_user_id, target_email, details)
  values (coalesce(auth.uid(), p_actor), p_action, p_target, (select email from auth.users where id = p_target), p_details);
end;
$$;
revoke execute on function public.admin_log_write(text, uuid, jsonb, uuid) from public, anon, authenticated;

drop function if exists public.admin_update_user(uuid, jsonb);
create or replace function public.admin_update_user(target_user_id uuid, patch jsonb, p_actor uuid default null)
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

  perform public.admin_log_write('update', target_user_id, patch - 'notes', p_actor);
end;
$$;

drop function if exists public.admin_set_setting(text, jsonb);
create or replace function public.admin_set_setting(p_key text, p_value jsonb, p_actor uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if p_key not in ('free_limits', 'invite_defaults') then raise exception 'Réglage inconnu'; end if;
  insert into public.app_settings (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.admin_log_write('setting', null, jsonb_build_object('key', p_key, 'value', p_value), p_actor);
end;
$$;

-- Marque la clé d'accès comme exigée (appelée par la fonction edge après avoir vérifié qu'une clé existe).
create or replace function public.admin_set_passkey_required(p_admin uuid, p_required boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  update public.admins set passkey_required = p_required where user_id = p_admin;
  perform public.admin_log_write(case when p_required then 'passkey_on' else 'passkey_off' end, p_admin, null, p_admin);
end;
$$;

revoke execute on function
  public.admin_update_user(uuid, jsonb, uuid), public.admin_set_setting(text, jsonb, uuid), public.admin_set_passkey_required(uuid, boolean)
from public, anon;
grant execute on function
  public.admin_update_user(uuid, jsonb, uuid), public.admin_set_setting(text, jsonb, uuid), public.admin_set_passkey_required(uuid, boolean)
to authenticated;
