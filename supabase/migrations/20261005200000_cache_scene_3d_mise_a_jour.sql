-- Vue 3D (5 octobre 2026): les environs passent en version 2 (les rues portent leur nom, repère
-- d'orientation pour l'analyse des façades d'après les images du client). Une entrée périmée du cache
-- peut être remplacée par un compte connecté; le déclencheur de validation s'applique aussi à la mise à jour.

grant update (version, data) on table public.scene3d_cache to authenticated;

drop policy if exists scene3d_update_authenticated on public.scene3d_cache;
create policy scene3d_update_authenticated on public.scene3d_cache
  for update to authenticated using (true) with check (true);
