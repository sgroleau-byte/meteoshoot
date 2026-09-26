// Configuration partagée (Supabase, Lemon Squeezy). Source unique pour toutes les pages.
export const SUPABASE_URL = 'https://mioiieshhjqpakdlsfzw.supabase.co';
export const SUPABASE_KEY = 'sb_publishable__6Z9fMxmUTmIieh5ABFBEQ_sHKygy2S';

// Origine publique du site (liens envoyés par courriel: confirmation, réinitialisation). Dans l'application
// native, window.location.origin vaudrait capacitor://localhost, inutilisable dans un courriel.
export const SITE_ORIGIN = 'https://meteoshoot.com';
export function publicOrigin() {
  const c = window.Capacitor;
  return (c && c.isNativePlatform && c.isNativePlatform()) ? SITE_ORIGIN : window.location.origin;
}

// Lemon Squeezy (abonnement web)
export const LEMON_CHECKOUT_URL = 'https://driftandgrain.lemonsqueezy.com/checkout/buy/62706175-0f3d-4cfa-a1e5-d7c4cc7f80c8';
