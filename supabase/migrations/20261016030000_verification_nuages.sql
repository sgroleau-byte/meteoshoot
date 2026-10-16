-- Vérification privée des prévisions de nuages (16 octobre 2026). Toutes les 6 h, la fonction cloud-verif range un
-- instantané par aéroport: prévisions de MeteoShoot (ICON, couverture combinée, ciel observé) et prévisions publiées par
-- Environnement Canada pour la ville voisine (api/verif-snapshot.js). La comparaison au ciel observé se fait plus tard
-- (tools/clouds/verif_live.py). Table privée: aucune règle d'accès, seule la clé de service des fonctions y touche.

create table if not exists public.cloud_verif (
  id bigint generated always as identity primary key,
  issued_at timestamptz not null,
  station text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (issued_at, station)
);
alter table public.cloud_verif enable row level security;
revoke all on public.cloud_verif from anon, authenticated;

-- Planification: pg_cron appelle la fonction toutes les 6 h (00 h 20, 06 h 20, 12 h 20 et 18 h 20 UTC)
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'cloud-verif-6h';
select cron.schedule('cloud-verif-6h', '20 */6 * * *', $job$
  select net.http_post(
    url := 'https://mioiieshhjqpakdlsfzw.supabase.co/functions/v1/cloud-verif',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);
