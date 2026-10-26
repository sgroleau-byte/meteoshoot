#!/usr/bin/env python3
"""Applique la configuration d'authentification Supabase de MeteoShoot (25 octobre 2026).

- Inscriptions libres fermées (comptes sur invitation seulement)
- Clés d'accès (passkeys: Face ID, Touch ID) comme méthode de connexion, pour la page dieu (l'API refuse WebAuthn
  comme second facteur sur ce projet; la clé d'accès remplace donc le mot de passe, exigée par la fonction admin-users)
- Adresses de retour autorisées: site, page dieu, serveur local
- Courriel d'invitation (gabarit supabase/templates/invite.html, sujet FR)

Le jeton du CLI Supabase (déjà connecté sur ce Mac) est lu dans le trousseau; rien n'est affiché.
Usage: python3 scripts/supabase-auth-config.py [--show]  (--show lit la configuration sans rien changer)
"""
import base64
import json
import subprocess
import sys
import urllib.request

PROJECT = "mioiieshhjqpakdlsfzw"
ROOT = __file__.rsplit("/scripts/", 1)[0]

def token():
    raw = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-w"], capture_output=True, text=True, check=True).stdout.strip()
    if raw.startswith("go-keyring-base64:"):
        raw = base64.b64decode(raw[len("go-keyring-base64:"):]).decode()
    return raw

def call(method, body=None):
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{PROJECT}/config/auth", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)

KEYS = ["disable_signup", "mailer_otp_exp", "site_url", "uri_allow_list", "passkey_enabled", "webauthn_rp_id", "webauthn_rp_origins",
        "mailer_subjects_invite", "smtp_host", "smtp_sender_name", "smtp_admin_email", "password_min_length"]

def show(cfg):
    for k in KEYS:
        print(f"  {k} = {cfg.get(k)}")
    print(f"  gabarit d'invitation: {len(cfg.get('mailer_templates_invite_content') or '')} caractères")

if __name__ == "__main__":
    if "--show" in sys.argv:
        show(call("GET")); sys.exit(0)
    current = call("GET")
    allow = [u for u in (current.get("uri_allow_list") or "").split(",") if u]
    for u in ["https://meteoshoot.com/**", "https://www.meteoshoot.com/**", "https://dieu.meteoshoot.com/**", "http://localhost:5173/**"]:
        if u not in allow: allow.append(u)
    patch = {
        "disable_signup": True,
        "mailer_otp_exp": 86400,  # liens de courriel (invitation, mot de passe oublié) valables 24 h, le maximum de Supabase
        "passkey_enabled": True,
        "webauthn_rp_display_name": "MeteoShoot",
        "webauthn_rp_id": "meteoshoot.com",
        "webauthn_rp_origins": "https://dieu.meteoshoot.com,https://www.meteoshoot.com,https://meteoshoot.com",
        "uri_allow_list": ",".join(allow),
        "mailer_subjects_invite": "Ton invitation à MeteoShoot",
        "mailer_templates_invite_content": open(f"{ROOT}/supabase/templates/invite.html", encoding="utf-8").read(),
    }
    # Un réglage à la fois: l'API refuse parfois un envoi groupé (422) qu'elle accepte réglage par réglage.
    for k, v in patch.items():
        call("PATCH", {k: v})
    print("Configuration appliquée:")
    show(call("GET"))
