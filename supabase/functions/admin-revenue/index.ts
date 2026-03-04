// MeteoShoot - Admin Revenue Proxy
// Supabase Edge Function
// Fetches orders & subscriptions from LemonSqueezy API (admin only)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LEMON_API_KEY = Deno.env.get("LEMON_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

const ADMIN_EMAIL = "sgroleau@me.com";
const LEMON_API = "https://api.lemonsqueezy.com/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function fetchAllPages(endpoint: string): Promise<any[]> {
  let results: any[] = [];
  let url: string | null = `${LEMON_API}/${endpoint}`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${LEMON_API_KEY}`, Accept: "application/vnd.api+json" },
    });
    if (!res.ok) {
      console.error(`LemonSqueezy API error: ${res.status} ${await res.text()}`);
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

  if (authError || !user || user.email !== ADMIN_EMAIL) {
    return new Response("Unauthorized", { status: 403, headers: corsHeaders });
  }

  try {
    const [orders, subscriptions] = await Promise.all([
      fetchAllPages("orders"),
      fetchAllPages("subscriptions"),
    ]);

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
