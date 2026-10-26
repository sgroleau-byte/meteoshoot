-- Questions de la première ouverture (26 octobre 2026): le photographe fait-il du drone, de la vidéo? Un « non »
-- cache les mandats DRONE, DRONE.C ou VID dans l'interface (réactivables dans les préférences). Partagé entre
-- appareils par les préférences du compte. onboarding_done: les deux questions ont été posées une fois.
alter table public.preferences
  add column if not exists does_drone boolean not null default true,
  add column if not exists does_video boolean not null default true,
  add column if not exists onboarding_done boolean not null default false;
alter table public.preferences_dev
  add column if not exists does_drone boolean not null default true,
  add column if not exists does_video boolean not null default true,
  add column if not exists onboarding_done boolean not null default false;
