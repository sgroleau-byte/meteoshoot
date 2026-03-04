// MeteoShoot - LemonSqueezy Webhook Handler
// Supabase Edge Function
// Handles subscription lifecycle events from LemonSqueezy

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LEMON_WEBHOOK_SECRET = Deno.env.get("LEMON_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

// Verify LemonSqueezy webhook signature
async function verifySignature(
  body: string,
  signature: string | null
): Promise<boolean> {
  if (!signature || !LEMON_WEBHOOK_SECRET) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(LEMON_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hex === signature;
}

serve(async (req: Request) => {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.text();
  const signature = req.headers.get("X-Signature");

  // Verify webhook signature
  const isValid = await verifySignature(body, signature);
  if (!isValid) {
    console.error("Invalid webhook signature");
    return new Response("Invalid signature", { status: 401 });
  }

  const payload = JSON.parse(body);
  const eventName = payload.meta?.event_name;
  const customData = payload.meta?.custom_data;
  const userId = customData?.user_id;

  if (!userId) {
    console.error("Missing user_id in custom data");
    return new Response("Missing user_id in custom data", { status: 400 });
  }

  console.log(`Processing event: ${eventName} for user: ${userId}`);

  // Use service role key for admin-level access
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Update both production and dev tables
  const tables = ["user_profiles", "user_profiles_dev"];

  try {
    switch (eventName) {
      case "subscription_created":
      case "subscription_updated": {
        const attrs = payload.data?.attributes;
        if (!attrs) break;

        const status =
          attrs.status === "active"
            ? "active"
            : attrs.status === "past_due"
            ? "past_due"
            : attrs.status === "cancelled"
            ? "canceled"
            : "expired";

        for (const table of tables) {
          const { error } = await supabase
            .from(table)
            .update({
              subscription_tier: "shooter",
              subscription_status: status,
              lemon_customer_id: String(attrs.customer_id),
              lemon_subscription_id: String(payload.data.id),
              payment_provider: "lemonsqueezy",
              current_period_end: attrs.renews_at || null,
            })
            .eq("user_id", userId);

          if (error) console.error(`Update error (${table}):`, error);
        }
        break;
      }

      case "subscription_cancelled": {
        for (const table of tables) {
          const { error } = await supabase
            .from(table)
            .update({ subscription_status: "canceled" })
            .eq("user_id", userId);

          if (error) console.error(`Cancel error (${table}):`, error);
        }
        break;
      }

      case "subscription_expired": {
        for (const table of tables) {
          const { error } = await supabase
            .from(table)
            .update({
              subscription_tier: "free",
              subscription_status: "expired",
              lemon_subscription_id: null,
              current_period_end: null,
            })
            .eq("user_id", userId);

          if (error) console.error(`Expire error (${table}):`, error);
        }
        break;
      }

      default:
        console.log(`Unhandled event: ${eventName}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return new Response("Internal error", { status: 500 });
  }
});
