-- Rappels par courriel avant la fin de la période gratuite (3 novembre 2026).
-- La fonction edge trial-reminders (appelée chaque jour par pg_cron) écrit ici chaque rappel envoyé: un rappel par
-- compte, par type (j7 = une semaine avant, j0 = le jour même) et par date de fin, donc jamais deux fois le même.
-- Si la date de fin change dans dieu, la nouvelle date a droit à ses propres rappels.
create table if not exists public.trial_reminders (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('j7', 'j0')),
  trial_ends_at timestamptz not null,
  sent_at timestamptz not null default now(),
  unique (user_id, kind, trial_ends_at)
);
alter table public.trial_reminders enable row level security;
revoke all on public.trial_reminders from anon, authenticated;

-- Planification: tous les jours à 13 h UTC (8 h ou 9 h au Québec selon la saison). La fonction est publique
-- (déployée avec --no-verify-jwt) et idempotente: un appel de plus ne renvoie rien.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'trial-reminders-daily';
select cron.schedule('trial-reminders-daily', '0 13 * * *', $job$
  select net.http_post(
    url := 'https://mioiieshhjqpakdlsfzw.supabase.co/functions/v1/trial-reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);
