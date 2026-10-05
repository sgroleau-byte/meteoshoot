-- Vue 3D (5 octobre 2026): l'analyse des images du client par Claude (colonne style3d, migration
-- 20261005150000) a été retirée le soir même, remplacée par les réglages manuels dans la pastille FORME
-- (hauteur, couleur des murs dans buildings). Plus aucun client ne lit ni n'écrit cette colonne.

alter table public.projects drop column if exists style3d;
alter table public.projects_dev drop column if exists style3d;
