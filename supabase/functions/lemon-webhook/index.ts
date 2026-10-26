// MeteoShoot - webhook Lemon Squeezy (réécrit le 26 octobre 2026, phase 4)
// Supabase Edge Function. Reçoit les événements d'abonnement et met le profil à jour (prod et dev).
//
// Règles:
// - L'identité vient de custom_data.user_id, posé dans l'adresse de paiement par l'app (checkout[custom][user_id]).
// - Variante Fondateur (secret LEMON_FOUNDER_VARIANT_ID, ou nom de variante contenant « fondateur » / « founder »):
//   is_founder passe à vrai et y reste (prix garanti à vie).
// - Statuts Lemon -> statut MeteoShoot: active/on_trial/paused -> active; past_due/unpaid -> past_due;
//   cancelled -> canceled (l'accès dure jusqu'à ends_at, puis l'événement expired ferme); expired -> expired + palier gratuit.
// - Chaque événement est rangé dans billing_events (table privée) pour comprendre un cas bizarre.
// Secrets attendus: LEMON_WEBHOOK_SECRET, SUPABASE_URL, SERVICE_ROLE_KEY (ou SUPABASE_SERVICE_ROLE_KEY),
// LEMON_FOUNDER_VARIANT_ID (optionnel).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LEMON_WEBHOOK_SECRET = Deno.env.get("LEMON_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY")!;
const FOUNDER_VARIANT_ID = Deno.env.get("LEMON_FOUNDER_VARIANT_ID") ?? "";

async function verifySignature(body: string, signature: string | null): Promise<boolean> {
  if (!signature || !LEMON_WEBHOOK_SECRET) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(LEMON_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // Comparaison à temps constant
  if (hex.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

const STATUS_MAP: Record<string, string> = {
  active: "active", on_trial: "active", paused: "active",
  past_due: "past_due", unpaid: "past_due",
  cancelled: "canceled", expired: "expired",
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const body = await req.text();
  if (!(await verifySignature(body, req.headers.get("X-Signature")))) {
    console.error("Signature invalide");
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: any;
  try { payload = JSON.parse(body); } catch { return new Response("Bad JSON", { status: 400 }); }
  const eventName: string = payload.meta?.event_name ?? "";
  const userId: string | undefined = payload.meta?.custom_data?.user_id;
  const attrs = payload.data?.attributes ?? {};
  const isSubscriptionEvent = eventName.startsWith("subscription_") && !eventName.startsWith("subscription_payment_");
  const isPaymentEvent = eventName.startsWith("subscription_payment_");

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Journal, avant tout traitement (même sans user_id: on garde la trace)
  const subscriptionId = isPaymentEvent ? String(attrs.subscription_id ?? "") : (isSubscriptionEvent ? String(payload.data?.id ?? "") : null);
  await supabase.from("billing_events").insert({
    event_name: eventName, user_id: userId ?? null, subscription_id: subscriptionId || null,
    customer_id: attrs.customer_id != null ? String(attrs.customer_id) : null,
    variant_id: attrs.variant_id != null ? String(attrs.variant_id) : null,
    variant_name: attrs.variant_name ?? null, status: attrs.status ?? null, test_mode: attrs.test_mode ?? null,
    payload,
  });

  if (!userId) {
    console.error("user_id absent de custom_data pour", eventName);
    return new Response(JSON.stringify({ received: true, ignored: "no user_id" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const tables = ["user_profiles", "user_profiles_dev"];
  const apply = async (patch: Record<string, unknown>) => {
    for (const t of tables) {
      const { error } = await supabase.from(t).update(patch).eq("user_id", userId);
      if (error) console.error(`profil (${t}):`, error.message);
    }
  };

  try {
    if (isSubscriptionEvent) {
      const lemonStatus: string = attrs.status ?? "";
      const status = STATUS_MAP[lemonStatus] ?? "expired";
      const variantId = attrs.variant_id != null ? String(attrs.variant_id) : null;
      const variantName: string = attrs.variant_name ?? "";
      const founderVariant = (FOUNDER_VARIANT_ID && variantId === FOUNDER_VARIANT_ID) || /fondateur|founder/i.test(variantName);

      if (status === "expired") {
        await apply({
          subscription_tier: "free", subscription_status: "expired",
          lemon_subscription_id: null, current_period_end: null, subscription_ends_at: null,
        });
      } else {
        const patch: Record<string, unknown> = {
          subscription_tier: "shooter", subscription_status: status,
          lemon_customer_id: attrs.customer_id != null ? String(attrs.customer_id) : null,
          lemon_subscription_id: String(payload.data.id),
          lemon_variant_id: variantId, lemon_variant_name: variantName || null,
          payment_provider: "lemonsqueezy",
          current_period_end: attrs.renews_at ?? null,
          subscription_ends_at: attrs.ends_at ?? null,
        };
        if (founderVariant) patch.is_founder = true;
        await apply(patch);
      }
    } else if (isPaymentEvent) {
      // Échec, reprise ou succès d'un paiement: le statut suit (l'événement subscription_updated arrive aussi).
      if (eventName === "subscription_payment_failed") await apply({ subscription_status: "past_due" });
      else if (eventName === "subscription_payment_success" || eventName === "subscription_payment_recovered") await apply({ subscription_status: "active" });
    } else {
      console.log("Événement non traité:", eventName);
    }
    return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Webhook:", err);
    return new Response("Internal error", { status: 500 });
  }
});
