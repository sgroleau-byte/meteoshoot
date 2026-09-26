-- Sécurité (26 septembre 2026)
-- 1. user_profiles / user_profiles_dev: un utilisateur connecté pouvait modifier ses propres colonnes
--    d'abonnement (subscription_tier, subscription_status...) depuis le navigateur, la règle de sécurité
--    par ligne autorisant toute mise à jour de sa propre ligne. Les droits passent au niveau des colonnes:
--    le client ne peut plus qu'insérer sa ligne de profil (les paliers prennent les valeurs par défaut)
--    et modifier son nom, son organisation et son secteur. Les colonnes d'abonnement restent réservées
--    au serveur (service_role: webhook Lemon Squeezy, fonctions admin, déclencheur handle_new_user).
-- 2. elevation_cache: n'importe qui (même sans compte) pouvait insérer, écraser ou supprimer les profils
--    de relief partagés. Désormais: lecture pour tous, insertion réservée aux utilisateurs connectés,
--    pas de modification ni de suppression par le client, contenu validé par un déclencheur.

-- ===== 1. Profils =====
revoke insert, update, delete on table public.user_profiles from anon, authenticated;
grant insert (user_id, full_name, organization, sector) on table public.user_profiles to authenticated;
grant update (full_name, organization, sector) on table public.user_profiles to authenticated;

revoke insert, update, delete on table public.user_profiles_dev from anon, authenticated;
grant insert (user_id, full_name, organization, sector) on table public.user_profiles_dev to authenticated;
grant update (full_name, organization, sector) on table public.user_profiles_dev to authenticated;

-- ===== 2. Cache d'altitude =====
revoke insert, update, delete on table public.elevation_cache from anon, authenticated;
grant insert (grid_lat, grid_lng, profile, observer_elevation, version) on table public.elevation_cache to authenticated;

drop policy if exists elevation_insert on public.elevation_cache;
drop policy if exists elevation_upsert on public.elevation_cache;
create policy elevation_insert_authenticated on public.elevation_cache
  for insert to authenticated with check (true);

create or replace function public.elevation_cache_validate()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  n integer;
  item jsonb;
begin
  if new.grid_lat is null or new.grid_lng is null
     or new.grid_lat < -90 or new.grid_lat > 90 or new.grid_lng < -180 or new.grid_lng > 180 then
    raise exception 'elevation_cache: coordonnées invalides';
  end if;
  if new.version is null or new.version < 1 or new.version > 100 then
    raise exception 'elevation_cache: version invalide';
  end if;
  if new.observer_elevation is not null and (new.observer_elevation < -500 or new.observer_elevation > 9000) then
    raise exception 'elevation_cache: altitude invalide';
  end if;
  if new.profile is null or jsonb_typeof(new.profile) <> 'array' then
    raise exception 'elevation_cache: profil invalide';
  end if;
  n := jsonb_array_length(new.profile);
  if n < 1 or n > 360 or pg_column_size(new.profile) > 20000 then
    raise exception 'elevation_cache: profil invalide (taille)';
  end if;
  for item in select value from jsonb_array_elements(new.profile) loop
    if jsonb_typeof(item) <> 'object'
       or jsonb_typeof(item->'bearing') <> 'number' or jsonb_typeof(item->'maxAngle') <> 'number'
       or (item->>'bearing')::numeric < 0 or (item->>'bearing')::numeric >= 360
       or (item->>'maxAngle')::numeric < 0 or (item->>'maxAngle')::numeric > 90 then
      raise exception 'elevation_cache: profil invalide (élément)';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists elevation_cache_validate on public.elevation_cache;
create trigger elevation_cache_validate
  before insert or update on public.elevation_cache
  for each row execute function public.elevation_cache_validate();
