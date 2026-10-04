-- Heure du shooting: heure de début sur place entrée dans la fiche (« HH:MM »), par exemple quand un intérieur
-- précède l'extérieur. Le départ affiché devient cette heure moins le trajet. Texte, vide = calcul au soleil.
--
-- Colonnes idempotentes (ADD COLUMN IF NOT EXISTS), aucune perte de données.

ALTER TABLE projects_dev ADD COLUMN IF NOT EXISTS shoot_time TEXT;
ALTER TABLE projects     ADD COLUMN IF NOT EXISTS shoot_time TEXT;
