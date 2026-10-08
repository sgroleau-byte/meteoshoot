-- Modèle 3D importé d'un projet (8 octobre 2026)
-- Le modèle de l'architecte (.kmz de SketchUp, préparé dans le navigateur en GLB allégé) suit le projet sur tous
-- les appareils. Une ligne par projet: chemin du fichier GLB dans le seau de stockage 'project-files' (dossier de
-- l'utilisateur: <user_id>/<project_id>/modele3d/<horodatage>.glb), informations de préparation (nom, taille,
-- emprise au sol, géoréférence) et placement sur le terrain. Séparation prod/dev comme project_files.
-- Pas de clé étrangère vers projects: un projet supprimé peut être rétabli pendant 60 secondes, l'app efface le
-- modèle seulement à la fin de ce délai.
-- Idempotente: peut être rejouée sans perte.

create table if not exists public.project_models (
  project_id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  storage_path text not null,
  info jsonb not null,
  placement jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.project_models_dev (
  project_id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  storage_path text not null,
  info jsonb not null,
  placement jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists project_models_user_id_idx on public.project_models (user_id);
create index if not exists project_models_dev_user_id_idx on public.project_models_dev (user_id);

alter table public.project_models enable row level security;
alter table public.project_models_dev enable row level security;

-- Comptes connectés seulement; chacun ne voit et ne touche que ses lignes (règles plus bas).
revoke all on table public.project_models from anon;
revoke all on table public.project_models_dev from anon;
grant select, insert, update, delete on table public.project_models to authenticated;
grant select, insert, update, delete on table public.project_models_dev to authenticated;

drop policy if exists "Users read own models" on public.project_models;
drop policy if exists "Users insert own models" on public.project_models;
drop policy if exists "Users update own models" on public.project_models;
drop policy if exists "Users delete own models" on public.project_models;
create policy "Users read own models" on public.project_models for select using (auth.uid() = user_id);
create policy "Users insert own models" on public.project_models for insert with check (auth.uid() = user_id);
create policy "Users update own models" on public.project_models for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own models" on public.project_models for delete using (auth.uid() = user_id);

drop policy if exists "Users read own models dev" on public.project_models_dev;
drop policy if exists "Users insert own models dev" on public.project_models_dev;
drop policy if exists "Users update own models dev" on public.project_models_dev;
drop policy if exists "Users delete own models dev" on public.project_models_dev;
create policy "Users read own models dev" on public.project_models_dev for select using (auth.uid() = user_id);
create policy "Users insert own models dev" on public.project_models_dev for insert with check (auth.uid() = user_id);
create policy "Users update own models dev" on public.project_models_dev for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own models dev" on public.project_models_dev for delete using (auth.uid() = user_id);
