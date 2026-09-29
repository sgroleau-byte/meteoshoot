# MeteoShoot

Weather-based shooting planner for photographers and videographers: www.meteoshoot.com, plus native iPhone and Android apps.

## Deployment

- Production: the `main` branch is deployed automatically to Vercel.
- Preview: the `dev` branch gets preview deployments on Vercel.

## Structure

- `index.html` and `site/`: application shell and account pages (login, signup, account).
- `src/`: application code (React, compiled with Vite).
- `public/`: static files served as is (icons, manifest, fonts, images).
- `ios/` and `android/`: native apps (Capacitor).
- `docs/`: project notes, in French.

## Commands

- `npm install`, then `npm run dev` (port 5173), `npm run build`, `npm run lint`.
- `npm run ios` and `npm run android`: native builds.

## Version

Shown on the splash screen and in Preferences; see `CLAUDE.md` for the versioning rule.
