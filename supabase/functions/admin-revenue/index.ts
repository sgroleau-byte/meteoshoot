// MeteoShoot - Admin Revenue Proxy
// Supabase Edge Function
// Fetches orders & subscriptions from LemonSqueezy API (admin only)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LEMON_API_KEY = Deno.env.get("LEMON_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

const LEMON_API = "https://api.lemonsqueezy.com/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const apiErrors: string[] = [];
async function fetchAllPages(endpoint: string): Promise<any[]> {
  let results: any[] = [];
  let url: string | null = `${LEMON_API}/${endpoint}`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${LEMON_API_KEY}`, Accept: "application/vnd.api+json" },
    });
    if (!res.ok) {
      const txt = await res.text();
      console.error(`LemonSqueezy API error: ${res.status} ${txt}`);
      apiErrors.push(`${endpoint}: ${res.status} ${txt.slice(0, 200)}`);
      break;
    }
    const json = await res.json();
    results = results.concat(json.data || []);
    url = json.links?.next || null;
  }
  return results;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  // Verify admin via JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return new Response("Unauthorized", { status: 403, headers: corsHeaders });
  }
  // Même porte que admin-users: table admins, et clé d'accès (Face ID) exigée dès qu'elle est enregistrée.
  const { data: adminRow } = await supabase.from("admins").select("user_id, passkey_required").eq("user_id", user.id).maybeSingle();
  if (!adminRow) {
    return new Response("Unauthorized", { status: 403, headers: corsHeaders });
  }
  if (adminRow.passkey_required) {
    let amr: { method?: string }[] = [];
    try {
      const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      amr = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "="))).amr || [];
    } catch { amr = []; }
    if (!amr.some((m) => /passkey|webauthn/i.test(String(m.method ?? "")))) {
      return new Response("Passkey required", { status: 403, headers: corsHeaders });
    }
  }

  try {
    const [orders, subscriptions, stores, products, variants] = await Promise.all([
      fetchAllPages("orders"),
      fetchAllPages("subscriptions"),
      fetchAllPages("stores"),
      fetchAllPages("products"),
      fetchAllPages("variants"),
    ]);

    // Catalogue (phase 4): boutiques avec leur devise, produits et variantes avec leurs prix, pour dieu.
    const catalog = {
      stores: stores.map((s: any) => ({ id: s.id, name: s.attributes.name, slug: s.attributes.slug, url: s.attributes.url, currency: s.attributes.currency, country: s.attributes.country, plan: s.attributes.plan })),
      products: products.map((p: any) => ({ id: p.id, store_id: p.attributes.store_id, name: p.attributes.name, status: p.attributes.status, price: p.attributes.price, price_formatted: p.attributes.price_formatted, buy_now_url: p.attributes.buy_now_url, test_mode: p.attributes.test_mode })),
      variants: variants.map((v: any) => ({ id: v.id, product_id: v.attributes.product_id, name: v.attributes.name, status: v.attributes.status, price: v.attributes.price, is_subscription: v.attributes.is_subscription, interval: v.attributes.interval, interval_count: v.attributes.interval_count, test_mode: v.attributes.test_mode })),
      errors: apiErrors.splice(0),
      key_present: !!LEMON_API_KEY,
      subscriptions: subscriptions.map((s: any) => ({ id: s.id, status: s.attributes.status, email: s.attributes.user_email, variant_id: s.attributes.variant_id, product_name: s.attributes.product_name, variant_name: s.attributes.variant_name, renews_at: s.attributes.renews_at, ends_at: s.attributes.ends_at, test_mode: s.attributes.test_mode, portal: s.attributes.urls?.customer_portal || null })),
    };

    // Calculate total revenue from orders
    let totalRevenue = 0;
    let currency = "USD";
    const orderList = orders.map((o: any) => {
      const attrs = o.attributes;
      const total = attrs.total / 100; // LemonSqueezy amounts are in cents
      totalRevenue += total;
      if (attrs.currency) currency = attrs.currency;
      return {
        id: o.id,
        email: attrs.user_email,
        total,
        status: attrs.status,
        created_at: attrs.created_at,
      };
    });

    // Count active subscriptions
    const activeSubscriptions = subscriptions.filter(
      (s: any) => s.attributes.status === "active"
    ).length;

    const result = {
      total_revenue: Math.round(totalRevenue * 100) / 100,
      currency,
      active_subscriptions: activeSubscriptions,
      total_subscriptions: subscriptions.length,
      total_orders: orders.length,
      orders: orderList.sort(
        (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
      catalog,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("Revenue fetch error:", err);
    return new Response(JSON.stringify({ error: "Failed to fetch revenue data" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
