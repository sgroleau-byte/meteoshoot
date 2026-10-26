// Configuration partagée (Supabase, Lemon Squeezy). Source unique pour toutes les pages.
export const SUPABASE_URL = 'https://mioiieshhjqpakdlsfzw.supabase.co';
export const SUPABASE_KEY = 'sb_publishable__6Z9fMxmUTmIieh5ABFBEQ_sHKygy2S';

// Origine publique du site (liens envoyés par courriel: confirmation, réinitialisation). Dans l'application
// native, window.location.origin vaudrait capacitor://localhost, inutilisable dans un courriel.
export const SITE_ORIGIN = 'https://meteoshoot.com';
export function publicOrigin() {
  const c = window.Capacitor;
  const native = window.location.protocol === 'capacitor:' || (window.location.protocol === 'https:' && window.location.hostname === 'localhost' && !window.location.port) || !!(c && c.isNativePlatform && c.isNativePlatform());
  return native ? SITE_ORIGIN : window.location.origin;
}

// Lemon Squeezy (abonnement web). Une seule boutique, en dollars canadiens; deux variantes du produit « MeteoShoot
// complet »: Fondateur (12,99 $ par mois, prix garanti à vie, par lien direct seulement) et Standard. Les adresses
// de paiement viennent du tableau de bord Lemon Squeezy (Partager > lien de paiement de la variante); tant qu'elles
// sont vides, le bouton de paiement est inactif. Le portail client (changer de carte, annuler) passe par la fonction
// edge billing-portal, qui renvoie l'adresse signée de l'abonnement de l'utilisateur.
export const LEMON_STORE = 'meteoshoot';
export const LEMON_CHECKOUT_FOUNDER = '';
export const LEMON_CHECKOUT_STANDARD = '';
export const LEMON_CHECKOUT_URL = LEMON_CHECKOUT_STANDARD; // compatibilité
export function lemonCheckoutUrl(user, isFounder) {
  const base = isFounder ? (LEMON_CHECKOUT_FOUNDER || LEMON_CHECKOUT_STANDARD) : LEMON_CHECKOUT_STANDARD;
  if (!base || !user) return '';
  return base + (base.includes('?') ? '&' : '?') + 'checkout[custom][user_id]=' + encodeURIComponent(user.id) + '&checkout[email]=' + encodeURIComponent(user.email || '');
}
export function openLemonCheckout(user, isFounder) {
  const url = lemonCheckoutUrl(user, isFounder);
  if (!url) return false;
  if (typeof window.createLemonSqueezy === 'function') window.createLemonSqueezy();
  if (window.LemonSqueezy && window.LemonSqueezy.Url) window.LemonSqueezy.Url.Open(url + '&embed=1');
  else window.open(url, '_blank');
  return true;
}
