-- Style 3D du projet (5 octobre 2026)
-- Résultat de l'analyse des images du client (fonction /api/scene3d-style): couleur du mur, soubassement,
-- rythme des fenêtres, étages, hauteur estimée, toit. Petit objet JSON par projet, nul par défaut.
alter table public.projects add column if not exists style3d jsonb;
alter table public.projects_dev add column if not exists style3d jsonb;
