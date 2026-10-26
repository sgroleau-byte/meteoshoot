// MeteoShoot - portail client Lemon Squeezy (26 octobre 2026, phase 4)
// Supabase Edge Function appelée par la page compte: renvoie l'adresse signée du portail client de l'abonnement de
// l'utilisateur connecté (changer de carte, annuler, reprendre). L'adresse vaut 24 heures; on la redemande à chaque
// clic. Secrets: LEMON_API_KEY, SUPABASE_URL, SERVICE_ROLE_KEY (ou SUPABASE_SERVICE_ROLE_KEY).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LEMON_API_KEY = Deno.env.get("LEMON_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY")!;
const ALLOWED = /^https:\/\/(www\.|dev\.)?meteoshoot\.com$|^http:\/\/localhost:\d+$|^capacitor:\/\/localhost$/;

const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED.test(origin) ? origin : "https://www.meteoshoot.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Vary": "Origin",
});
const json = (o: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "GET") return json({ error: "Méthode refusée" }, 405, origin);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Non autorisé" }, 401, origin);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return json({ error: "Non autorisé" }, 401, origin);

  const { data: profile } = await admin.from("user_profiles").select("lemon_subscription_id").eq("user_id", user.id).maybeSingle();
  if (!profile?.lemon_subscription_id) return json({ error: "Aucun abonnement" }, 404, origin);
  if (!LEMON_API_KEY) return json({ error: "Clé Lemon Squeezy absente" }, 500, origin);

  const res = await fetch(`https://api.lemonsqueezy.com/v1/subscriptions/${profile.lemon_subscription_id}`, {
    headers: { Authorization: `Bearer ${LEMON_API_KEY}`, Accept: "application/vnd.api+json" },
  });
  if (!res.ok) {
    console.error("Lemon:", res.status, (await res.text()).slice(0, 200));
    return json({ error: "Lemon Squeezy injoignable" }, 502, origin);
  }
  const sub = await res.json();
  const urls = sub.data?.attributes?.urls ?? {};
  return json({ portal: urls.customer_portal ?? null, update_payment: urls.update_payment_method ?? null, status: sub.data?.attributes?.status ?? null }, 200, origin);
});
