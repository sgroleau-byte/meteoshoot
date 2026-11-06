-- Témoins météo (6 novembre 2026)
-- Un photographe sur place note le ciel qu'il voit (un choix d'un toucher) avec une photo, l'heure et sa position. L'app
-- fige au même moment ce qu'elle annonçait pour ce lieu et cette heure (forecast): la comparaison se fait plus tard sans
-- rien recalculer. Données privées: chacun ne voit que ses témoins; l'analyse se fait par la clé de service.
-- Photo dans le seau 'project-files', dossier de l'utilisateur: <user_id>/temoins/<id>.jpg (règles du seau existantes).
-- project_id: projet rattaché (fiche ouverte, ou projet le plus proche à moins de 1 km), sinon null. Pas de clé étrangère:
-- le témoin garde sa valeur si le projet est supprimé.
-- Séparation prod/dev comme les autres tables. Idempotente: peut être rejouée sans perte.

create table if not exists public.sky_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  observed_at timestamptz not null default now(),
  lat double precision not null,
  lng double precision not null,
  accuracy_m real,
  project_id text,
  sky text not null check (sky in ('clear', 'clouds', 'overcast', 'fog', 'rain', 'snow')),
  photo_path text,
  forecast jsonb,
  app_version text,
  created_at timestamptz not null default now()
);

create table if not exists public.sky_reports_dev (like public.sky_reports including all);

create index if not exists sky_reports_user_id_idx on public.sky_reports (user_id, observed_at desc);
create index if not exists sky_reports_dev_user_id_idx on public.sky_reports_dev (user_id, observed_at desc);

alter table public.sky_reports enable row level security;
alter table public.sky_reports_dev enable row level security;

-- Comptes connectés seulement; chacun ajoute, lit et retire ses propres témoins, sans les modifier après coup.
revoke all on table public.sky_reports from anon;
revoke all on table public.sky_reports_dev from anon;
grant select, insert, delete on table public.sky_reports to authenticated;
grant select, insert, delete on table public.sky_reports_dev to authenticated;

drop policy if exists "Users read own sky reports" on public.sky_reports;
drop policy if exists "Users insert own sky reports" on public.sky_reports;
drop policy if exists "Users delete own sky reports" on public.sky_reports;
create policy "Users read own sky reports" on public.sky_reports for select using (auth.uid() = user_id);
create policy "Users insert own sky reports" on public.sky_reports for insert with check (auth.uid() = user_id);
create policy "Users delete own sky reports" on public.sky_reports for delete using (auth.uid() = user_id);

drop policy if exists "Users read own sky reports dev" on public.sky_reports_dev;
drop policy if exists "Users insert own sky reports dev" on public.sky_reports_dev;
drop policy if exists "Users delete own sky reports dev" on public.sky_reports_dev;
create policy "Users read own sky reports dev" on public.sky_reports_dev for select using (auth.uid() = user_id);
create policy "Users insert own sky reports dev" on public.sky_reports_dev for insert with check (auth.uid() = user_id);
create policy "Users delete own sky reports dev" on public.sky_reports_dev for delete using (auth.uid() = user_id);
