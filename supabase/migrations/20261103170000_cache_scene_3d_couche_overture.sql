-- Vue 3D (3 novembre 2026, v633.267): la lecture d'Overture (13 s sur les 28 s d'un calcul d'environs) est gardée à part
-- dans le cache partagé, sous la clé « ovt_lat_lng », pour qu'une nouvelle version des environs (règles LiDAR) ne la
-- refasse plus. Même règle que « dem_ » et « hor_ »: préfixe accepté par le déclencheur de validation.

create or replace function public.scene3d_cache_validate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.key is null or new.key !~ '^(dem_|hor_|ovt_)?-?[0-9]{1,2}\.[0-9]{5}_-?[0-9]{1,3}\.[0-9]{5}$' then
    raise exception 'scene3d_cache: clé invalide';
  end if;
  if new.lat is null or new.lng is null
     or new.lat < -90 or new.lat > 90 or new.lng < -180 or new.lng > 180 then
    raise exception 'scene3d_cache: coordonnées invalides';
  end if;
  if new.version is null or new.version < 1 or new.version > 100 then
    raise exception 'scene3d_cache: version invalide';
  end if;
  if new.data is null or jsonb_typeof(new.data) <> 'object' or pg_column_size(new.data) > 2000000 then
    raise exception 'scene3d_cache: données invalides';
  end if;
  return new;
end;
$$;
