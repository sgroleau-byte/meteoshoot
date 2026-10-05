-- Vue 3D du projet (5 octobre 2026)
-- Cache partagé des environs d'un lieu (bâtiments voisins avec hauteur, rues, arbres, parcs, eau),
-- calculés par la fonction serveur /api/scene3d à partir des données ouvertes Overture Maps
-- (empreintes Microsoft et OpenStreetMap). Un lieu = une ligne, clé = latitude et longitude arrondies
-- à 5 décimales. Même règle que elevation_cache: lecture pour tous, insertion réservée aux comptes
-- connectés, pas de modification ni de suppression par le client, contenu validé par un déclencheur.

create table if not exists public.scene3d_cache (
  key text primary key,
  lat double precision not null,
  lng double precision not null,
  version integer not null default 1,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.scene3d_cache enable row level security;

revoke insert, update, delete on table public.scene3d_cache from anon, authenticated;
grant select on table public.scene3d_cache to anon, authenticated;
grant insert (key, lat, lng, version, data) on table public.scene3d_cache to authenticated;

drop policy if exists scene3d_select_all on public.scene3d_cache;
create policy scene3d_select_all on public.scene3d_cache
  for select using (true);

drop policy if exists scene3d_insert_authenticated on public.scene3d_cache;
create policy scene3d_insert_authenticated on public.scene3d_cache
  for insert to authenticated with check (true);

create or replace function public.scene3d_cache_validate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.key is null or new.key !~ '^-?[0-9]{1,2}\.[0-9]{5}_-?[0-9]{1,3}\.[0-9]{5}$' then
    raise exception 'scene3d_cache: clé invalide';
  end if;
  if new.lat is null or new.lng is null
     or new.lat < -90 or new.lat > 90 or new.lng < -180 or new.lng > 180 then
    raise exception 'scene3d_cache: coordonnées invalides';
  end if;
  if new.version is null or new.version < 1 or new.version > 100 then
    raise exception 'scene3d_cache: version invalide';
  end if;
  if new.data is null or jsonb_typeof(new.data) <> 'object' or pg_column_size(new.data) > 600000 then
    raise exception 'scene3d_cache: données invalides';
  end if;
  return new;
end;
$$;

drop trigger if exists scene3d_cache_validate on public.scene3d_cache;
create trigger scene3d_cache_validate
  before insert or update on public.scene3d_cache
  for each row execute function public.scene3d_cache_validate();
