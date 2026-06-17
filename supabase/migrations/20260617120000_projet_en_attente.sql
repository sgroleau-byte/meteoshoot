-- Projet « en attente »: un projet déjà saisi mais que le client n'est pas prêt
-- à faire shooter. La carte affiche alors « EN ATTENTE » et atténue son contenu
-- central. État booléen par projet, partagé entre le web et la PWA.
--
-- Colonnes idempotentes (ADD COLUMN IF NOT EXISTS), aucune perte de données.

ALTER TABLE projects_dev ADD COLUMN IF NOT EXISTS on_hold BOOLEAN DEFAULT FALSE;
ALTER TABLE projects     ADD COLUMN IF NOT EXISTS on_hold BOOLEAN DEFAULT FALSE;
