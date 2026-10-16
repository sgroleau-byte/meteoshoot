// MeteoShoot - vérification privée des prévisions de nuages (16 octobre 2026)
// Supabase Edge Function, appelée toutes les 6 h par pg_cron (migration 20261016030000_verification_nuages.sql).
// Instantané: demande à api/verif-snapshot.js (Vercel) les prévisions des 33 aéroports et les range dans cloud_verif.
// Au plus un instantané toutes les 150 minutes (la fonction est publique: des appels répétés ne font rien).
// Lecture (?report=1&since=AAAA-MM-JJ): réservée au jeton VERIF_REPORT_TOKEN (secret Supabase, gardé hors du dépôt).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY")!;
const REPORT_TOKEN = Deno.env.get("VERIF_REPORT_TOKEN");
const SNAPSHOT_URL = "https://www.meteoshoot.com/api/verif-snapshot";

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const url = new URL(req.url);

  if (url.searchParams.get("report")) {
    if (!REPORT_TOKEN || req.headers.get("x-verif-token") !== REPORT_TOKEN) return json({ error: "refusé" }, 403);
    const since = url.searchParams.get("since") || "2000-01-01";
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("cloud_verif").select("issued_at,station,data").gte("issued_at", since).order("issued_at").order("station").range(from, from + 999);
      if (error) return json({ error: error.message }, 500);
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return json({ rows });
  }

  const { data: last } = await db.from("cloud_verif").select("issued_at").order("issued_at", { ascending: false }).limit(1);
  if (last && last[0] && Date.now() - Date.parse(last[0].issued_at) < 150 * 60000) return json({ skipped: true, last: last[0].issued_at });
  const res = await fetch(`${SNAPSHOT_URL}?h=${Math.floor(Date.now() / 3600000)}`, { signal: AbortSignal.timeout(110000) });
  if (!res.ok) return json({ error: `instantané ${res.status}` }, 502);
  const snap = await res.json();
  if (!snap || !Array.isArray(snap.stations) || !snap.stations.length) return json({ error: "instantané vide" }, 502);
  const rows = snap.stations.map((s: { id: string }) => ({ issued_at: snap.issued, station: s.id, data: s }));
  const { error } = await db.from("cloud_verif").upsert(rows, { onConflict: "issued_at,station", ignoreDuplicates: true });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, issued: snap.issued, stations: rows.length });
});
