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

// Lemon Squeezy (abonnement web). Boutique Drift&Grain (dollars canadiens), produit « MeteoShoot complet » avec deux
// variantes: Fondateur (12,99 $ par mois, prix garanti à vie) et Standard. Aucun lien de paiement dans le code: la
// fonction edge create-checkout crée, pour l'utilisateur connecté, un paiement sur la bonne variante (courriel rempli,
// compte rattaché), et renvoie l'adresse à ouvrir. Tant que les variantes ne sont pas réglées côté serveur (secrets),
// elle répond « pas encore ouvert » et le bouton le dit. Le portail client passe par billing-portal.
export const LEMON_STORE = 'driftandgrain';
export const LEMON_CHECKOUT_URL = ''; // compatibilité: plus de lien fixe
export async function openLemonCheckout(supabaseClient, lang) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return { ok: false, code: 'no_session' };
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang }),
  });
  let data = {};
  try { data = await res.json(); } catch { /* corps vide */ }
  if (!res.ok || !data.url) return { ok: false, code: data.code || 'error', error: data.error };
  if (typeof window.createLemonSqueezy === 'function') window.createLemonSqueezy();
  if (window.LemonSqueezy && window.LemonSqueezy.Url) window.LemonSqueezy.Url.Open(data.url);
  else window.open(data.url, '_blank', 'noopener');
  return { ok: true, founder: !!data.founder };
}
