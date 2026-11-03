-- Vue 3D (3 novembre 2026, v633.266): le relief n'était plus jamais gardé dans le cache partagé scene3d_cache
-- depuis le relief lointain précis (v633.194, 11 octobre 2026): une entrée « dem_ » pèse 1,4 Mo (hauteurs à 1 m
-- autour du bâtiment et grille polaire jusqu'à 20 km, en base64) et le déclencheur refusait toute donnée de plus de
-- 600 Ko. L'app avalait l'erreur en silence (try/catch de src/scene3d/terrain.js) et recalculait le relief à chaque
-- ouverture (7 s côté serveur, 755 Ko à télécharger), masqué par le cache du navigateur (24 h) et celui de Vercel.
-- Les 5 entrées « dem_ » en base étaient toutes restées en version 1 (9 au 11 octobre). Limite portée à 2 Mo.

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
  if new.data is null or jsonb_typeof(new.data) <> 'object' or pg_column_size(new.data) > 2000000 then
    raise exception 'scene3d_cache: données invalides';
  end if;
  return new;
end;
$$;
