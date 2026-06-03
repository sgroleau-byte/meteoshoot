-- Dossiers client (regroupement des projets) + tag, et état ouvert/fermé des dossiers.
-- Ces colonnes étaient déclarées dans setup.sql (point 14) mais n'ont jamais été
-- appliquées à la base. Sans elles, assigner un projet à un dossier échoue côté
-- Supabase (la colonne n'existe pas) et le dossier est perdu dès que les données
-- sont rechargées depuis Supabase (à la reconnexion).
--
-- Colonnes idempotentes (ADD COLUMN IF NOT EXISTS), aucune perte de données.

ALTER TABLE projects_dev ADD COLUMN IF NOT EXISTS client_folder TEXT;
ALTER TABLE projects_dev ADD COLUMN IF NOT EXISTS tag           TEXT;
ALTER TABLE projects     ADD COLUMN IF NOT EXISTS client_folder TEXT;
ALTER TABLE projects     ADD COLUMN IF NOT EXISTS tag           TEXT;

-- État ouvert/fermé des dossiers, par utilisateur, partagé entre le web et la PWA.
-- Carte { "NOM DU DOSSIER": true|false } (true = ouvert).
ALTER TABLE preferences_dev ADD COLUMN IF NOT EXISTS folder_states JSONB DEFAULT '{}'::jsonb;
ALTER TABLE preferences     ADD COLUMN IF NOT EXISTS folder_states JSONB DEFAULT '{}'::jsonb;
