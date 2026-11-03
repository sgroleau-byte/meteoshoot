// MeteoShoot - rappels de fin de période gratuite (3 novembre 2026)
// Supabase Edge Function appelée chaque jour par pg_cron (migration 20261103120000_rappels_fin_gratuite.sql).
// Pour chaque compte en période gratuite, non payant et non désactivé, dont l'invitation a été acceptée:
//   - j7: une semaine avant la fin (entre 2 et 7 jours restants, une seule fois par date de fin)
//   - j0: le jour même (moins d'un jour restant, ou fin passée depuis moins de 3 jours)
// Les courriels partent par l'API Resend (secret RESEND_API_KEY), dans la langue du compte, au design de l'invitation.
// Chaque envoi est noté dans trial_reminders (jamais deux fois) et dans admin_log (journal de dieu).
// Appel { "dry": true }: liste ce qui partirait (types, jours restants, langues) sans rien envoyer ni noter.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SITE = "https://www.meteoshoot.com";
const FROM = "MeteoShoot <noreply@meteoshoot.com>";
const SUPPORT = "info@driftgrain.app";
const DAY = 86400000;

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

const MONTHS = {
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};
// Date lisible, à l'heure du Québec.
function fmtDate(iso: string, lang: "fr" | "en") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const d = get("day"), m = get("month") - 1, y = get("year");
  return lang === "en" ? `${MONTHS.en[m]} ${d}, ${y}` : `${d === 1 ? "1er" : d} ${MONTHS.fr[m]} ${y}`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

type Limits = { maxProjects?: number; scene3d?: boolean };

function compose(opts: { kind: "j7" | "j0"; lang: "fr" | "en"; name: string | null; daysLeft: number; ended: boolean; endsAt: string; founder: boolean; founderPrice: string; limits: Limits }) {
  const { kind, lang, name, daysLeft, ended, endsAt, founder, founderPrice, limits } = opts;
  const en = lang === "en";
  const first = (name || "").trim().split(/\s+/)[0] || "";
  const hello = en ? `Hello${first ? " " + esc(first) : ""},` : `Bonjour${first ? " " + esc(first) : ""},`;
  const n = Number.isFinite(limits.maxProjects) ? limits.maxProjects : 3;
  const freeDesc = en
    ? `${n} active projects${limits.scene3d ? "" : ", without the 3D view"}`
    : `${n} projets actifs${limits.scene3d ? "" : ", sans la vue 3D"}`;
  const date = fmtDate(endsAt, lang);

  let subject: string, lead: string;
  if (kind === "j7") {
    subject = en ? `MeteoShoot: ${daysLeft} free days left` : `MeteoShoot: encore ${daysLeft} jours gratuits`;
    lead = en
      ? `Your free period on MeteoShoot ends in ${daysLeft} days, on ${date}. After that date your account switches to the free version: ${freeDesc}. Your projects stay where they are.`
      : `Ta période gratuite sur MeteoShoot se termine dans ${daysLeft} jours, le ${date}. Après cette date, ton compte passe à la version gratuite: ${freeDesc}. Tes projets restent en place.`;
  } else {
    subject = en
      ? (ended ? "MeteoShoot: your free period has ended" : "MeteoShoot: your free period ends today")
      : (ended ? "MeteoShoot: ta période gratuite est terminée" : "MeteoShoot: ta période gratuite se termine aujourd'hui");
    lead = en
      ? `${ended ? "Your free period on MeteoShoot has just ended" : "Your free period on MeteoShoot ends today"}. Your account switches to the free version: ${freeDesc}. Nothing is deleted: your projects stay where they are.`
      : `${ended ? "Ta période gratuite sur MeteoShoot vient de se terminer" : "Ta période gratuite sur MeteoShoot se termine aujourd'hui"}. Ton compte passe à la version gratuite: ${freeDesc}. Rien n'est effacé: tes projets restent en place.`;
  }
  const offer = founder
    ? (en
      ? `To keep full access, your founder price of ${esc(founderPrice)} is reserved for you and locked for life as long as you stay subscribed.`
      : `Pour garder tout l'accès, ton prix fondateur de ${esc(founderPrice)} t'est réservé et reste garanti à vie tant que tu restes abonné.`)
    : (en
      ? `To keep full access, you can subscribe from your account page at any time.`
      : `Pour garder tout l'accès, tu peux t'abonner à tout moment depuis ta page compte.`);
  const button = en ? "KEEP FULL ACCESS" : "GARDER L'ACCÈS COMPLET";
  const questions = en
    ? `Questions? Write to me at ${SUPPORT}.`
    : `Des questions? Écris-moi à ${SUPPORT}.`;

  const html = `<div style="background:#181b1e;padding:48px 20px;">
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Avenir Next','Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;color:#e6e6e6;">
    <div style="text-align:center;margin-bottom:36px;">
      <div style="font-size:22px;font-weight:300;letter-spacing:0.18em;color:#ffffff;">METEOSHOOT</div>
    </div>
    <p style="font-size:17px;line-height:1.65;margin:0 0 18px;color:#e6e6e6;">${hello}</p>
    <p style="font-size:16px;line-height:1.65;margin:0 0 18px;color:#c9c9c9;">${lead}</p>
    <p style="font-size:16px;line-height:1.65;margin:0 0 30px;color:#c9c9c9;">${offer}</p>
    <div style="text-align:center;margin:30px 0 36px;">
      <a href="${SITE}/site/account.html" style="display:inline-block;background:#aad7d0;color:#181b1e;padding:14px 34px;text-decoration:none;font-size:14px;letter-spacing:0.12em;font-weight:600;">${button}</a>
    </div>
    <p style="font-size:13px;line-height:1.6;margin:0;color:#7a7f82;">${questions}</p>
    <p style="font-size:13px;line-height:1.6;margin:24px 0 0;color:#7a7f82;">Stéphane Groleau<br>meteoshoot.com</p>
  </div>
</div>`;
  const text = `${hello}\n\n${lead}\n\n${offer}\n\n${button}: ${SITE}/site/account.html\n\n${questions}\n\nStéphane Groleau\nmeteoshoot.com`;
  return { subject, html, text };
}

const isPaid = (p: { subscription_tier: string; subscription_status: string }) =>
  (p.subscription_tier === "shooter" || p.subscription_tier === "god") && (p.subscription_status === "active" || p.subscription_status === "past_due");

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST attendu" }, 405);
  let body: { dry?: boolean } = {};
  try { body = await req.json(); } catch { /* corps vide */ }
  const dry = !!body.dry;

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const now = Date.now();
  const { data: profiles, error } = await db
    .from("user_profiles")
    .select("user_id, full_name, trial_ends_at, is_founder, subscription_tier, subscription_status")
    .is("disabled_at", null)
    .not("trial_ends_at", "is", null)
    .gte("trial_ends_at", new Date(now - 3 * DAY).toISOString())
    .lte("trial_ends_at", new Date(now + 7.5 * DAY).toISOString());
  if (error) return json({ error: error.message }, 500);

  const { data: settingsRows } = await db.from("app_settings").select("key, value").in("key", ["free_limits", "invite_defaults"]);
  const settings: Record<string, any> = {};
  for (const r of settingsRows || []) settings[r.key] = r.value;
  const limits: Limits = settings.free_limits || { maxProjects: 3, scene3d: false };
  const founderPrice: string = settings.invite_defaults?.founderPrice || "12,99 $ par mois";

  const planned: unknown[] = [];
  const sent: unknown[] = [];
  const errors: unknown[] = [];

  for (const p of profiles || []) {
    if (isPaid(p)) continue;
    const msLeft = Date.parse(p.trial_ends_at) - now;
    const daysLeft = Math.ceil(msLeft / DAY);
    let kind: "j7" | "j0";
    if (daysLeft >= 2 && daysLeft <= 7) kind = "j7";
    else if (daysLeft <= 1) kind = "j0";
    else continue;

    const { data: prev } = await db.from("trial_reminders").select("id").eq("user_id", p.user_id).eq("kind", kind).eq("trial_ends_at", p.trial_ends_at).maybeSingle();
    if (prev) continue;

    const { data: got } = await db.auth.admin.getUserById(p.user_id);
    const user = got?.user;
    if (!user?.email || !user.last_sign_in_at) continue; // invitation jamais acceptée: rien à rappeler
    const lang: "fr" | "en" = user.user_metadata?.lang === "en" ? "en" : "fr";
    const name = p.full_name || user.user_metadata?.full_name || null;

    if (dry) { planned.push({ kind, days_left: daysLeft, lang }); continue; }
    if (!RESEND_API_KEY) return json({ error: "RESEND_API_KEY manquante: rien envoyé", planned: planned.length }, 503);

    const mail = compose({ kind, lang, name, daysLeft, ended: msLeft <= 0, endsAt: p.trial_ends_at, founder: !!p.is_founder, founderPrice, limits });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [user.email], reply_to: SUPPORT, subject: mail.subject, html: mail.html, text: mail.text }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      errors.push({ user_id: p.user_id, kind, status: res.status, body: (await res.text()).slice(0, 300) });
      continue;
    }
    const { error: insErr } = await db.from("trial_reminders").insert({ user_id: p.user_id, kind, trial_ends_at: p.trial_ends_at });
    if (insErr) errors.push({ user_id: p.user_id, kind, note: insErr.message });
    await db.from("admin_log").insert({
      admin_id: null, action: `reminder_${kind}`, target_user_id: p.user_id, target_email: user.email,
      details: { days_left: daysLeft, lang, trial_ends_at: p.trial_ends_at, founder: !!p.is_founder },
    });
    sent.push({ kind, days_left: daysLeft, lang });
  }

  return json({ ok: true, dry, candidates: (profiles || []).length, planned, sent, errors, resend_configured: !!RESEND_API_KEY });
});
