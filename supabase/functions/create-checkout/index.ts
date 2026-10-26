// MeteoShoot - création d'un paiement Lemon Squeezy (26 octobre 2026, phase 4)
// Supabase Edge Function appelée par l'app (web) et la page compte: pour l'utilisateur connecté, crée un paiement
// Lemon Squeezy sur la bonne variante (Fondateur si le profil est fondateur, sinon Standard), courriel rempli et
// compte rattaché (custom user_id, lu ensuite par lemon-webhook), et renvoie l'adresse à ouvrir. Aucun lien de
// paiement n'est écrit dans le code: les variantes se changent par les secrets.
// Secrets: LEMON_API_KEY, LEMON_STORE_ID, LEMON_FOUNDER_VARIANT_ID, LEMON_STANDARD_VARIANT_ID, SUPABASE_URL,
// SERVICE_ROLE_KEY (ou SUPABASE_SERVICE_ROLE_KEY).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LEMON_API_KEY = Deno.env.get("LEMON_API_KEY") ?? "";
const STORE_ID = Deno.env.get("LEMON_STORE_ID") ?? "";
const FOUNDER_VARIANT = Deno.env.get("LEMON_FOUNDER_VARIANT_ID") ?? "";
const STANDARD_VARIANT = Deno.env.get("LEMON_STANDARD_VARIANT_ID") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY")!;
const SITE = "https://www.meteoshoot.com";
const ALLOWED = /^https:\/\/(www\.|dev\.)?meteoshoot\.com$|^http:\/\/localhost:\d+$/;

const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED.test(origin) ? origin : SITE,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const json = (o: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Méthode refusée" }, 405, origin);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Non autorisé" }, 401, origin);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return json({ error: "Non autorisé" }, 401, origin);

  if (!LEMON_API_KEY || !STORE_ID || !STANDARD_VARIANT) return json({ error: "Paiement pas encore ouvert", code: "not_ready" }, 503, origin);

  const { data: profile } = await admin.from("user_profiles").select("is_founder, subscription_tier, subscription_status, lemon_subscription_id").eq("user_id", user.id).maybeSingle();
  const paid = !!profile && ["shooter", "god"].includes(profile.subscription_tier) && ["active", "past_due"].includes(profile.subscription_status);
  if (paid && profile?.lemon_subscription_id) return json({ error: "Abonnement déjà actif", code: "already" }, 409, origin);

  const founder = !!profile?.is_founder && !!FOUNDER_VARIANT;
  const variantId = founder ? FOUNDER_VARIANT : STANDARD_VARIANT;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* corps vide accepté */ }
  const lang = body.lang === "en" ? "en" : "fr";

  const payload = {
    data: {
      type: "checkouts",
      attributes: {
        checkout_data: { email: user.email, custom: { user_id: user.id } },
        checkout_options: { embed: false, media: false, logo: true, dark: true },
        product_options: {
          enabled_variants: [Number(variantId)],
          redirect_url: `${SITE}/site/account.html?paid=1`,
          receipt_button_text: lang === "en" ? "Back to MeteoShoot" : "Retour à MeteoShoot",
          receipt_thank_you_note: lang === "en" ? "Welcome to the full version." : "Bienvenue dans la version complète.",
        },
        expires_at: new Date(Date.now() + 24 * 3600000).toISOString(),
      },
      relationships: {
        store: { data: { type: "stores", id: String(STORE_ID) } },
        variant: { data: { type: "variants", id: String(variantId) } },
      },
    },
  };
  const res = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
    method: "POST",
    headers: { Authorization: `Bearer ${LEMON_API_KEY}`, Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error("Lemon checkout:", res.status, (await res.text()).slice(0, 300));
    return json({ error: "Lemon Squeezy n'a pas pu créer le paiement" }, 502, origin);
  }
  const data = await res.json();
  return json({ url: data.data?.attributes?.url ?? null, founder }, 200, origin);
});
