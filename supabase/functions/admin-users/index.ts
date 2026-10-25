// MeteoShoot - gestion des comptes par l'admin (25 octobre 2026)
// Supabase Edge Function appelée par la page dieu (dieu.meteoshoot.com). Une seule porte d'entrée pour tout ce que
// l'admin fait sur les comptes; la clé de service ne quitte jamais ce serveur.
//
//   me                  état de l'appelant (admin?, clé d'accès exigée?, session ouverte par clé d'accès?, clés)
//   list / stats / log  lecture (fonctions SQL admin_get_all_users, admin_get_stats, admin_get_log)
//   update  { user_id, patch }           fin de gratuité, fondateur, palier, notes, désactivation (admin_update_user)
//   setting { key, value }               réglages de l'application (admin_set_setting)
//   invite  { email, full_name, organization, lang, trial_days, is_founder }   invitation par courriel
//   resend  { user_id }                  renvoie l'invitation
//   disable { user_id } / enable { user_id }   bloque ou débloque la connexion
//   delete  { user_id, confirm_email }   supprime le compte, ses fichiers et ses données
//   passkey_registered                   après l'enregistrement d'une clé d'accès: la clé devient exigée
//   passkey_delete { passkey_id }        retire une clé (la dernière retire aussi l'exigence)
//
// Sécurité: jeton de session vérifié; appelant présent dans public.admins; dès que admins.passkey_required est vrai,
// la session doit avoir été ouverte par clé d'accès (Face ID, Touch ID): méthode « passkey » dans la liste amr du
// jeton. Les écritures passent par les fonctions SQL avec l'auteur explicite, et tout est journalisé (admin_log).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY")!;
const SITE_ORIGIN = "https://www.meteoshoot.com";
const ALLOWED_ORIGINS = ["https://dieu.meteoshoot.com"];
const originAllowed = (o: string | null) => !!o && (ALLOWED_ORIGINS.includes(o) || /^http:\/\/localhost:\d+$/.test(o));
const isPasskeyMethod = (m: unknown) => /passkey|webauthn/i.test(String(m ?? ""));

const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": originAllowed(origin) ? origin! : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const json = (o: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });

function jwtClaims(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "=")));
  } catch { return {}; }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Méthode refusée" }, 405, origin);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Non autorisé" }, 401, origin);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, experimental: { passkey: true } } });
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return json({ error: "Non autorisé" }, 401, origin);

  const { data: adminRow } = await admin.from("admins").select("user_id, passkey_required").eq("user_id", user.id).maybeSingle();
  if (!adminRow) return json({ error: "Non autorisé" }, 403, origin);

  const claims = jwtClaims(token);
  const amr = Array.isArray(claims.amr) ? (claims.amr as { method?: string }[]) : [];
  const viaPasskey = amr.some((m) => isPasskeyMethod(m.method));
  if (action === "me") console.log("amr:", JSON.stringify(amr.map((m) => m.method)));

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Corps invalide" }, 400, origin); }
  const action = String(body.action || "");

  const listPasskeys = async () => {
    const { data } = await admin.auth.admin.passkey.listPasskeys({ userId: user.id });
    return (data as unknown as { passkeys?: unknown[] })?.passkeys ?? (Array.isArray(data) ? data : []);
  };

  if (action === "me") {
    const passkeys = await listPasskeys();
    return json({
      ok: !adminRow.passkey_required || viaPasskey,
      email: user.email, passkey_required: adminRow.passkey_required, via_passkey: viaPasskey,
      methods: amr.map((m) => m.method), passkeys,
    }, 200, origin);
  }
  if (adminRow.passkey_required && !viaPasskey) return json({ error: "Face ID requis", code: "passkey_required" }, 403, origin);

  const tables = ["user_profiles", "user_profiles_dev"];
  const log = (act: string, target: string | null, details: unknown) =>
    admin.from("admin_log").insert({ admin_id: user.id, action: act, target_user_id: target, target_email: (details as { email?: string })?.email ?? null, details });

  try {
    switch (action) {
      case "list": {
        const { data, error } = await admin.rpc("admin_get_all_users");
        if (error) throw error;
        return json({ users: data }, 200, origin);
      }
      case "stats": {
        const { data, error } = await admin.rpc("admin_get_stats");
        if (error) throw error;
        const { data: settings } = await admin.from("app_settings").select("key, value, updated_at");
        return json({ stats: data, settings }, 200, origin);
      }
      case "log": {
        const { data, error } = await admin.rpc("admin_get_log", { p_limit: Number(body.limit ?? 100) || 100 });
        if (error) throw error;
        return json({ log: data }, 200, origin);
      }
      case "update": {
        const userId = String(body.user_id || "");
        const patch = (body.patch && typeof body.patch === "object") ? body.patch : null;
        if (!userId || !patch) return json({ error: "Paramètres manquants" }, 400, origin);
        const { error } = await admin.rpc("admin_update_user", { target_user_id: userId, patch, p_actor: user.id });
        if (error) return json({ error: error.message }, 400, origin);
        return json({ ok: true }, 200, origin);
      }
      case "setting": {
        const { error } = await admin.rpc("admin_set_setting", { p_key: String(body.key || ""), p_value: body.value ?? {}, p_actor: user.id });
        if (error) return json({ error: error.message }, 400, origin);
        return json({ ok: true }, 200, origin);
      }
      case "passkey_registered": {
        // Le verrou ne s'enclenche que depuis une session ouverte par clé d'accès: ainsi, si le serveur nommait la
        // méthode autrement que prévu, le verrou ne se fermerait jamais sur une porte qu'on ne sait pas rouvrir.
        if (!viaPasskey) return json({ error: "Entre d'abord avec Face ID, puis verrouille", code: "need_passkey_session", methods: amr.map((m) => m.method) }, 400, origin);
        const passkeys = await listPasskeys();
        if (!passkeys.length) return json({ error: "Aucune clé d'accès enregistrée" }, 400, origin);
        const { error } = await admin.rpc("admin_set_passkey_required", { p_admin: user.id, p_required: true });
        if (error) return json({ error: error.message }, 400, origin);
        return json({ ok: true, passkeys }, 200, origin);
      }
      case "passkey_delete": {
        const passkeyId = String(body.passkey_id || "");
        if (!passkeyId) return json({ error: "passkey_id manquant" }, 400, origin);
        const { error } = await admin.auth.admin.passkey.deletePasskey({ userId: user.id, passkeyId });
        if (error) return json({ error: error.message }, 400, origin);
        const left = await listPasskeys();
        if (!left.length) await admin.rpc("admin_set_passkey_required", { p_admin: user.id, p_required: false });
        await log("passkey_delete", user.id, { email: user.email, passkey_id: passkeyId });
        return json({ ok: true, passkeys: left }, 200, origin);
      }
      case "invite": {
        const email = String(body.email || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Courriel invalide" }, 400, origin);
        const fullName = String(body.full_name || "").trim() || null;
        const organization = String(body.organization || "").trim() || null;
        const lang = body.lang === "en" ? "en" : "fr";
        const trialDays = Math.max(0, Math.min(3650, Number(body.trial_days ?? 90) || 0));
        const isFounder = !!body.is_founder;

        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { full_name: fullName, organization, lang, invited: true },
          redirectTo: `${SITE_ORIGIN}/site/signup.html`,
        });
        if (error) {
          const msg = /already|registered|exists/i.test(error.message) ? "Ce courriel a déjà un compte" : error.message;
          return json({ error: msg }, 400, origin);
        }
        const invited = data.user;
        const trialEnds = trialDays > 0 ? new Date(Date.now() + trialDays * 86400000).toISOString() : null;
        for (const t of tables) {
          // Le déclencheur handle_new_user a créé la ligne; on la complète (ou on la crée si le déclencheur manquait).
          const { error: upErr } = await admin.from(t).upsert({
            user_id: invited.id, full_name: fullName, organization,
            invited_at: new Date().toISOString(), invited_by: user.id, trial_ends_at: trialEnds, is_founder: isFounder,
          }, { onConflict: "user_id" });
          if (upErr) console.error(`profil (${t}):`, upErr.message);
        }
        await log("invite", invited.id, { email, trial_days: trialDays, is_founder: isFounder, lang });
        return json({ ok: true, user_id: invited.id }, 200, origin);
      }
    }

    // Actions sur un compte existant
    const userId = String(body.user_id || "");
    if (!userId) return json({ error: "user_id manquant" }, 400, origin);
    const { data: target, error: tErr } = await admin.auth.admin.getUserById(userId);
    if (tErr || !target?.user) return json({ error: "Utilisateur inconnu" }, 404, origin);
    if (target.user.id === user.id && (action === "disable" || action === "delete")) {
      return json({ error: "Pas sur ton propre compte" }, 400, origin);
    }
    const email = target.user.email!;

    if (action === "resend") {
      if (target.user.last_sign_in_at) return json({ error: "Ce compte est déjà actif" }, 400, origin);
      const meta = target.user.user_metadata || {};
      const { error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: meta.full_name ?? null, organization: meta.organization ?? null, lang: meta.lang ?? "fr", invited: true },
        redirectTo: `${SITE_ORIGIN}/site/signup.html`,
      });
      if (error) return json({ error: error.message }, 400, origin);
      await log("resend", userId, { email });
      return json({ ok: true }, 200, origin);
    }

    if (action === "disable" || action === "enable") {
      const disable = action === "disable";
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: disable ? "876600h" : "none" });
      if (error) return json({ error: error.message }, 400, origin);
      for (const t of tables) await admin.from(t).update({ disabled_at: disable ? new Date().toISOString() : null }).eq("user_id", userId);
      await log(action, userId, { email });
      return json({ ok: true }, 200, origin);
    }

    if (action === "delete") {
      if (String(body.confirm_email || "").trim().toLowerCase() !== email.toLowerCase()) {
        return json({ error: "Confirmation du courriel manquante" }, 400, origin);
      }
      // Fichiers de stockage du compte, puis le compte (les tables suivent par suppression en cascade).
      for (const bucket of ["project-files"]) {
        const { data: files } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
        if (files?.length) await admin.storage.from(bucket).remove(files.map((f) => `${userId}/${f.name}`));
      }
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 400, origin);
      await log("delete", null, { email, user_id: userId });
      return json({ ok: true }, 200, origin);
    }

    return json({ error: "Action inconnue" }, 400, origin);
  } catch (e) {
    console.error("admin-users:", e);
    return json({ error: (e as Error)?.message || "Erreur interne" }, 500, origin);
  }
});
