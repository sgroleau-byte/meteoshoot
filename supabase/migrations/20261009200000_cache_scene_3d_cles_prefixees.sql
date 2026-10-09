-- Vue 3D (9 octobre 2026, v633.186): le cache partagé scene3d_cache sert aussi au relief (clé « dem_ » depuis la
-- v633.162) et au profil d'horizon du relief réel (clé « hor_ », barre « ombre du terrain » de la fiche projet).
-- Le déclencheur de validation n'acceptait que la clé nue « lat_lng »: les entrées « dem_ » étaient refusées en
-- silence (aucune en base le 9 octobre 2026, le relief était recalculé à chaque ouverture, masqué par le cache du
-- navigateur et de Vercel). Préfixe optionnel accepté: dem_ ou hor_.

create or replace function public.scene3d_cache_validate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.key is null or new.key !~ '^(dem_|hor_)?-?[0-9]{1,2}\.[0-9]{5}_-?[0-9]{1,3}\.[0-9]{5}$' then
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
