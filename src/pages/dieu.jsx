// Page dieu (25 octobre 2026): le tableau de bord de Stéphane, hors de l'application, servi sur dieu.meteoshoot.com.
// Entrée par clé d'accès (Face ID, Touch ID) dès qu'une clé est enregistrée; toutes les opérations passent par la
// fonction edge admin-users (clé de service côté serveur, journal des actions). Comptes: inviter, prolonger la
// gratuité, marquer fondateur, changer le palier, notes, désactiver, supprimer. Réglages: ce que garde un compte
// gratuit, défauts d'invitation, clés d'accès. Journal: toutes les actions.
import './dieu.css';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../shared/config.js';
import { TRANSLATIONS } from '../shared/translations.js';

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { experimental: { passkey: true } } });
const FN_USERS = `${SUPABASE_URL}/functions/v1/admin-users`;
const FN_REVENUE = `${SUPABASE_URL}/functions/v1/admin-revenue`;
const PASSKEY_OK_HOST = /(^|\.)meteoshoot\.com$/.test(window.location.hostname);

// ===== Appels à la fonction edge =====
class ApiError extends Error { constructor(msg, code, status, methods) { super(msg); this.code = code; this.status = status; this.methods = methods; } }
async function api(action, body = {}) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) throw new ApiError('Session fermée', 'no_session', 401);
  const res = await fetch(FN_USERS, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  let payload = {};
  try { payload = await res.json(); } catch { /* corps vide */ }
  if (!res.ok) throw new ApiError(payload.error || `Erreur ${res.status}`, payload.code, res.status, payload.methods);
  return payload;
}

// ===== Dates =====
const MONTHS = TRANSLATIONS.fr.monthAbbrev.map(m => m.toLowerCase());
const fmtDate = (d) => { if (!d) return '-'; const x = new Date(d); return `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`; };
const fmtDateTime = (d) => { if (!d) return '-'; const x = new Date(d); return `${fmtDate(d)}, ${String(x.getHours()).padStart(2, '0')} h ${String(x.getMinutes()).padStart(2, '0')}`; };
const daysUntil = (d) => Math.ceil((new Date(d) - Date.now()) / 86400000);
const relative = (d) => {
  if (!d) return 'jamais';
  const diff = Date.now() - new Date(d);
  const m = Math.round(diff / 60000);
  if (m < 2) return 'à l’instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `il y a ${h} h`;
  const j = Math.round(h / 24);
  if (j < 60) return `il y a ${j} j`;
  return fmtDate(d);
};
const toDateInput = (d) => { if (!d) return ''; const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const fromDateInput = (s) => { if (!s) return null; const x = new Date(`${s}T23:59:59`); return x.toISOString(); };

// ===== État d'un compte =====
const isPaid = (u) => ['shooter', 'god'].includes(u.subscription_tier) && ['active', 'past_due'].includes(u.subscription_status);
const inTrial = (u) => !!u.trial_ends_at && new Date(u.trial_ends_at) > new Date();
const stateOf = (u) => {
  if (u.disabled_at) return 'disabled';
  if (u.invited_at && !u.last_sign_in_at) return 'invited';
  if (isPaid(u)) return 'paid';
  if (inTrial(u)) return 'trial';
  if (u.trial_ends_at) return 'expired';
  return 'free';
};
const STATE_LABEL = { disabled: 'DÉSACTIVÉ', invited: 'INVITÉ', paid: 'ABONNÉ', trial: 'EN ESSAI', expired: 'ESSAI TERMINÉ', free: 'GRATUIT' };
const STATE_BADGE = { disabled: 'badge-disabled', invited: 'badge-invited', paid: 'badge-paid', trial: 'badge-trial', expired: 'badge-expired', free: 'badge-free' };
const TIER_LABEL = { free: 'GRATUIT', shooter: 'COMPLET', god: 'GOD', disabled: 'DÉSACTIVÉ' };
const TIER_BADGE = { free: 'badge-free', shooter: 'badge-paid', god: 'badge-paid', disabled: 'badge-disabled' };
const FILTERS = [
  ['all', 'Tous'], ['invited', 'Invités'], ['trial', 'En essai'], ['expired', 'Essai terminé'], ['paid', 'Abonnés'], ['founder', 'Fondateurs'], ['disabled', 'Désactivés'],
];

const Badge = ({ cls, children }) => <span className={`badge ${cls}`}>{children}</span>;
const Toast = ({ toast }) => toast ? <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.text}</div> : null;

const FaceIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <path d="M9 9h.01" /><path d="M15 9h.01" /><path d="M9.5 15a3.5 3.5 0 0 0 5 0" />
  </svg>
);

// ===== Écran d'entrée =====
const Gate = ({ title, children }) => (
  <div className="gate">
    <div className="gate-card">
      <div className="gate-title">{title}</div>
      {children}
    </div>
  </div>
);

const LoginGate = ({ onDone }) => {
  const [mode, setMode] = useState(PASSKEY_OK_HOST ? 'passkey' : 'password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const withPasskey = async () => {
    setBusy(true); setError('');
    const { error: err } = await supabaseClient.auth.signInWithPasskey();
    setBusy(false);
    if (err) { setError(err.message === 'The operation either timed out or was not allowed.' ? 'Annulé.' : err.message); return; }
    onDone();
  };
  const withPassword = async () => {
    if (!email || !password) return;
    setBusy(true); setError('');
    const { error: err } = await supabaseClient.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) { setError('Les nuages passent, les mauvais mots de passe restent.'); return; }
    onDone();
  };

  return (
    <Gate title="DIEU">
      {mode === 'passkey' ? (
        <>
          <div className="gate-text">Entrée réservée. Face ID ou Touch ID.</div>
          <button className="btn btn-primary btn-face" onClick={withPasskey} disabled={busy}><FaceIcon />{busy ? 'VÉRIFICATION' : 'ENTRER'}</button>
          {error && <div className="gate-error">{error}</div>}
          <button className="link-btn" style={{ alignSelf: 'flex-start', marginTop: '6px' }} onClick={() => setMode('password')}>Entrer avec le mot de passe</button>
        </>
      ) : (
        <>
          <div className="field"><label>COURRIEL</label><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" autoFocus /></div>
          <div className="field"><label>MOT DE PASSE</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && withPassword()} autoComplete="current-password" /></div>
          {error && <div className="gate-error">{error}</div>}
          <button className="btn btn-primary btn-face" onClick={withPassword} disabled={busy || !email || !password}>{busy ? 'CONNEXION' : 'ENTRER'}</button>
          {PASSKEY_OK_HOST && <button className="link-btn" style={{ alignSelf: 'flex-start', marginTop: '6px' }} onClick={() => setMode('passkey')}>Entrer avec Face ID</button>}
        </>
      )}
    </Gate>
  );
};

const signOut = async () => { await supabaseClient.auth.signOut(); window.location.reload(); };

// ===== Tableau de bord =====
const Dashboard = ({ me, onMeChange }) => {
  const [view, setView] = useState('users'); // users | settings | log | revenue
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const notify = useCallback((text, error = false) => {
    setToast({ text, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), error ? 4500 : 2200);
  }, []);

  const load = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([api('list'), api('stats')]);
      setUsers(l.users || []);
      setStats(s.stats || null);
      const map = {};
      (s.settings || []).forEach(r => { map[r.key] = r.value; });
      setSettings(map);
    } catch (e) {
      if (e.code === 'passkey_required') { onMeChange(); return; }
      notify(e.message, true);
    }
    setLoading(false);
  }, [notify, onMeChange]);

  useEffect(() => { load(); }, [load]);

  const run = async (action, body, okText) => {
    try {
      const r = await api(action, body);
      if (okText) notify(okText);
      await load();
      return r;
    } catch (e) {
      notify(e.message, true);
      return null;
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(u => {
      if (filter === 'founder' ? !u.is_founder : (filter !== 'all' && stateOf(u) !== filter)) return false;
      if (!q) return true;
      return [u.email, u.full_name, u.organization, u.notes].some(v => (v || '').toLowerCase().includes(q));
    });
  }, [users, filter, search]);

  const counts = useMemo(() => {
    const c = { all: users.length, founder: users.filter(u => u.is_founder).length };
    users.forEach(u => { const s = stateOf(u); c[s] = (c[s] || 0) + 1; });
    return c;
  }, [users]);

  return (
    <div className="dieu-wrap">
      <div className="dieu-inner">
        <div className="dieu-header">
          <div className="t-title">DIEU <span style={{ color: '#c0bcb5' }}>|</span> METEOSHOOT</div>
          <div className="dieu-nav">
            {[['users', 'COMPTES'], ['revenue', 'REVENUS'], ['log', 'JOURNAL'], ['settings', 'RÉGLAGES']].map(([k, l]) => (
              <button key={k} className={`nav-btn ${view === k ? 'active' : ''}`} onClick={() => setView(k)}>{l}</button>
            ))}
            <button className="btn btn-primary" onClick={() => { setView('users'); setShowInvite(v => !v); }}>INVITER</button>
            <button className="btn" onClick={signOut}>SORTIR</button>
          </div>
        </div>

        {!me.passkey_required && PASSKEY_OK_HOST && (
          <PasskeyNudge me={me} onDone={onMeChange} notify={notify} />
        )}

        {view === 'users' && (
          <>
            <StatsRow stats={stats} counts={counts} filter={filter} setFilter={setFilter} />
            {showInvite && <InvitePanel settings={settings} founders={counts.founder} onClose={() => setShowInvite(false)} run={run} />}
            <div className="toolbar">
              <div className="filters">
                {FILTERS.map(([k, l]) => (
                  <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{l}{counts[k] ? ` ${counts[k]}` : ''}</button>
                ))}
              </div>
              <input className="input search" placeholder="Chercher un courriel, un nom, une note" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <UsersTable users={filtered} loading={loading} openId={openId} setOpenId={setOpenId} run={run} me={me} />
          </>
        )}
        {view === 'settings' && <SettingsView settings={settings} me={me} run={run} onMeChange={onMeChange} notify={notify} />}
        {view === 'log' && <LogView />}
        {view === 'revenue' && <RevenueView />}
      </div>
      <Toast toast={toast} />
    </div>
  );
};

// ----- Face ID à enregistrer -----
const LOCK_PENDING = 'dieu-lock-pending';
const lockWithPasskey = async (notify, onDone) => {
  // Après l'enregistrement: on ferme la session mot de passe, on rentre avec Face ID, et le serveur verrouille
  // seulement s'il constate que cette session est bien ouverte par clé d'accès.
  sessionStorage.setItem(LOCK_PENDING, '1');
  await supabaseClient.auth.signOut();
  const { error } = await supabaseClient.auth.signInWithPasskey();
  if (error) { sessionStorage.removeItem(LOCK_PENDING); notify(error.message, true); window.location.reload(); return; }
  try {
    await api('passkey_registered');
    sessionStorage.removeItem(LOCK_PENDING);
    notify('Face ID en place. Dieu est maintenant verrouillé.');
  } catch (e) {
    sessionStorage.removeItem(LOCK_PENDING);
    notify(e.methods ? `Verrou non posé: méthode de session « ${e.methods.join(', ')} »` : e.message, true);
  }
  onDone();
};

const PasskeyNudge = ({ me, onDone, notify }) => {
  const [busy, setBusy] = useState(false);
  const hasKey = (me.passkeys || []).length > 0;
  const register = async () => {
    setBusy(true);
    if (!hasKey) {
      const { error } = await supabaseClient.auth.registerPasskey();
      if (error) { setBusy(false); notify(error.message, true); return; }
    }
    await lockWithPasskey(notify, onDone);
    setBusy(false);
  };
  return (
    <div className="panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
      <div>
        <div className="t-label" style={{ marginBottom: '6px' }}>SÉCURITÉ</div>
        <div style={{ fontSize: '14px', color: 'var(--ink-2)', lineHeight: 1.5 }}>
          {hasKey
            ? 'Ta clé d\u2019accès est enregistrée mais dieu n\u2019est pas encore verrouillé. Entre avec Face ID pour fermer la porte au mot de passe seul.'
            : 'Verrouille dieu avec Face ID ou Touch ID. Tu enregistres la clé, tu rentres une fois avec Face ID, et le mot de passe seul ne suffit plus.'}
        </div>
      </div>
      <button className="btn btn-primary" onClick={register} disabled={busy}><FaceIcon />{busy ? 'EN COURS' : hasKey ? 'VERROUILLER AVEC FACE ID' : 'ACTIVER FACE ID'}</button>
    </div>
  );
};

// ----- Statistiques -----
const StatsRow = ({ stats, counts, filter, setFilter }) => {
  if (!stats) return null;
  const cards = [
    ['invited', 'INVITATIONS EN ATTENTE', counts.invited || 0],
    ['trial', 'EN ESSAI', counts.trial || 0],
    ['expired', 'ESSAI TERMINÉ', counts.expired || 0],
    ['paid', 'ABONNÉS', counts.paid || 0],
    ['founder', 'FONDATEURS', counts.founder || 0],
    [null, 'PROJETS', stats.total_projects || 0],
  ];
  return (
    <div className="stats">
      {cards.map(([k, label, value]) => (
        <div key={label} className={`stat-card ${k ? 'clickable' : ''} ${k && filter === k ? 'active' : ''}`} onClick={() => k && setFilter(filter === k ? 'all' : k)}>
          <div className="stat-number">{value}</div>
          <div className="stat-label">{label}</div>
        </div>
      ))}
    </div>
  );
};

// ----- Inviter -----
const InvitePanel = ({ settings, founders, onClose, run }) => {
  const defaults = settings.invite_defaults || { trialDays: 90, founderSeats: 50 };
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');
  const [lang, setLang] = useState('fr');
  const [days, setDays] = useState(defaults.trialDays ?? 90);
  const [founder, setFounder] = useState(founders < (defaults.founderSeats ?? 50));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email) return;
    setBusy(true);
    const r = await run('invite', { email, full_name: name, organization: org, lang, trial_days: Number(days), is_founder: founder }, `Invitation envoyée à ${email}`);
    setBusy(false);
    if (r) { setEmail(''); setName(''); setOrg(''); }
  };

  return (
    <div className="panel">
      <div className="t-section">INVITER UN PHOTOGRAPHE</div>
      <div className="panel-grid">
        <div className="field"><label>COURRIEL</label><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus /></div>
        <div className="field"><label>PRÉNOM NOM</label><input className="input" value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="field"><label>ORGANISATION</label><input className="input" value={org} onChange={e => setOrg(e.target.value)} /></div>
        <div className="field"><label>JOURS GRATUITS</label><input className="input" type="number" min="0" max="3650" value={days} onChange={e => setDays(e.target.value)} /></div>
        <div className="field"><label>LANGUE DU COURRIEL</label>
          <div className="seg"><button className={lang === 'fr' ? 'active' : ''} onClick={() => setLang('fr')}>FR</button><button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button></div>
        </div>
        <div className="field"><label>FONDATEUR</label>
          <label className="check"><input type="checkbox" checked={founder} onChange={e => setFounder(e.target.checked)} />Prix garanti à vie ({founders} sur {defaults.founderSeats ?? 50})</label>
        </div>
      </div>
      <div className="panel-actions">
        <button className="btn btn-primary" onClick={submit} disabled={busy || !email}>{busy ? 'ENVOI' : 'ENVOYER L’INVITATION'}</button>
        <button className="btn" onClick={onClose}>FERMER</button>
        <span className="t-muted">Le courriel part de noreply@meteoshoot.com; le lien vaut 24 heures.</span>
      </div>
    </div>
  );
};

// ----- Table des comptes -----
const UsersTable = ({ users, loading, openId, setOpenId, run, me }) => (
  <div>
    <div className="user-header">
      <div>COMPTE</div><div>ÉTAT</div><div className="hide-sm">FOND.</div><div className="hide-md">GRATUIT JUSQU’AU</div>
      <div className="hide-md">PALIER</div><div className="hide-sm">DERNIÈRE VISITE</div><div className="hide-md">PROJ.</div>
    </div>
    {loading && <div className="t-muted" style={{ padding: '18px 12px' }}>Chargement</div>}
    {!loading && users.length === 0 && <div className="t-muted" style={{ padding: '18px 12px' }}>Aucun compte ici.</div>}
    {users.map(u => {
      const st = stateOf(u);
      const open = openId === u.user_id;
      const days = u.trial_ends_at ? daysUntil(u.trial_ends_at) : null;
      return (
        <React.Fragment key={u.user_id}>
          <div className={`user-row ${open ? 'open' : ''} ${st === 'disabled' ? 'disabled' : ''}`} onClick={() => setOpenId(open ? null : u.user_id)}>
            <div className="cell-main">
              <div className="cell-email">{u.email}</div>
              <div className="cell-sub">{[u.full_name, u.organization].filter(Boolean).join(' / ') || u.sector || ''}</div>
            </div>
            <div><Badge cls={STATE_BADGE[st]}>{STATE_LABEL[st]}</Badge></div>
            <div className="hide-sm"><span className={`dot ${u.is_founder ? '' : 'dot-off'}`} /></div>
            <div className="hide-md" style={{ fontSize: '13px' }}>
              {u.trial_ends_at ? (
                <>
                  {fmtDate(u.trial_ends_at)}
                  <div className={`cell-sub ${days < 0 ? 'countdown-over' : days <= 14 ? 'countdown-soon' : ''}`}>
                    {days < 0 ? `terminé il y a ${-days} j` : days === 0 ? 'se termine aujourd’hui' : `dans ${days} j`}
                  </div>
                </>
              ) : <span className="t-muted">-</span>}
            </div>
            <div className="hide-md"><Badge cls={TIER_BADGE[u.effective_tier] || 'badge-free'}>{TIER_LABEL[u.effective_tier] || u.effective_tier}</Badge></div>
            <div className="hide-sm" style={{ fontSize: '13px', color: 'var(--ink-2)' }}>{relative(u.last_seen_at || u.last_sign_in_at)}</div>
            <div className="hide-md t-mono">{u.project_count}</div>
          </div>
          {open && <UserDetail u={u} st={st} run={run} me={me} />}
        </React.Fragment>
      );
    })}
  </div>
);

const UserDetail = ({ u, st, run, me }) => {
  const [notes, setNotes] = useState(u.notes || '');
  const [date, setDate] = useState(toDateInput(u.trial_ends_at));
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const isSelf = u.email === me.email;

  const update = (patch, msg) => run('update', { user_id: u.user_id, patch }, msg);
  const extend = (n) => {
    const base = u.trial_ends_at && new Date(u.trial_ends_at) > new Date() ? new Date(u.trial_ends_at) : new Date();
    base.setDate(base.getDate() + n);
    update({ trial_ends_at: base.toISOString() }, `Gratuit jusqu’au ${fmtDate(base)}`);
  };

  return (
    <div className="user-detail" onClick={e => e.stopPropagation()}>
      <div className="detail-grid">
        <div className="detail-block">
          <dl className="detail-facts">
            <dt>INSCRIT</dt><dd>{fmtDate(u.created_at)}{u.invited_at ? `, invité le ${fmtDate(u.invited_at)}` : ''}</dd>
            <dt>CONNEXION</dt><dd>{u.last_sign_in_at ? fmtDateTime(u.last_sign_in_at) : 'jamais'}{u.last_seen_at ? `, vu ${relative(u.last_seen_at)}` : ''}</dd>
            <dt>SECTEUR</dt><dd>{u.sector || '-'}</dd>
            <dt>ABONNEMENT</dt><dd>{u.lemon_subscription_id ? `Lemon Squeezy ${u.lemon_subscription_id}, ${u.subscription_status}${u.current_period_end ? `, renouvellement ${fmtDate(u.current_period_end)}` : ''}` : `${TIER_LABEL[u.subscription_tier] || u.subscription_tier} (${u.subscription_status})`}</dd>
          </dl>

          <div className="field">
            <label>NOTES</label>
            <textarea className="textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ce qu'il a dit, ce qu'il attend, d'où il vient" />
            {notes !== (u.notes || '') && <div><button className="btn btn-small" onClick={() => update({ notes }, 'Notes enregistrées')}>ENREGISTRER LES NOTES</button></div>}
          </div>
        </div>

        <div className="detail-block">
          <div className="field">
            <label>GRATUIT JUSQU’AU</label>
            <div className="row-actions">
              <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: '170px' }} />
              {date !== toDateInput(u.trial_ends_at) && <button className="btn btn-small" onClick={() => update({ trial_ends_at: fromDateInput(date) }, date ? `Gratuit jusqu’au ${fmtDate(fromDateInput(date))}` : 'Gratuité retirée')}>APPLIQUER</button>}
              <button className="btn btn-small" onClick={() => extend(30)}>+30 J</button>
              <button className="btn btn-small" onClick={() => extend(90)}>+90 J</button>
            </div>
          </div>

          <div className="field">
            <label>FONDATEUR ET PALIER</label>
            <div className="row-actions">
              <label className="check"><input type="checkbox" checked={!!u.is_founder} onChange={e => update({ is_founder: e.target.checked }, e.target.checked ? 'Fondateur' : 'Plus fondateur')} />Fondateur, prix garanti</label>
              <select className="select" style={{ width: '170px' }} value={u.subscription_tier || 'free'} onChange={e => update({ subscription_tier: e.target.value }, `Palier: ${TIER_LABEL[e.target.value]}`)}>
                <option value="free">Gratuit</option><option value="shooter">Complet (offert)</option><option value="god">God</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label>ACTIONS</label>
            <div className="row-actions">
              {st === 'invited' && <button className="btn btn-small" onClick={() => run('resend', { user_id: u.user_id }, 'Invitation renvoyée')}>RENVOYER L’INVITATION</button>}
              {!isSelf && (u.disabled_at
                ? <button className="btn btn-small" onClick={() => run('enable', { user_id: u.user_id }, 'Compte réactivé')}>RÉACTIVER</button>
                : <button className="btn btn-small btn-danger" onClick={() => run('disable', { user_id: u.user_id }, 'Compte désactivé')}>DÉSACTIVER</button>)}
              {!isSelf && !deleting && <button className="btn btn-small btn-danger" onClick={() => setDeleting(true)}>SUPPRIMER</button>}
            </div>
            {deleting && (
              <div className="row-actions" style={{ marginTop: '8px' }}>
                <input className="input" placeholder="Recopie le courriel pour confirmer" value={confirm} onChange={e => setConfirm(e.target.value)} style={{ width: '280px' }} />
                <button className="btn btn-small btn-danger" disabled={confirm.trim().toLowerCase() !== u.email.toLowerCase()} onClick={() => run('delete', { user_id: u.user_id, confirm_email: confirm }, 'Compte supprimé')}>SUPPRIMER POUR DE BON</button>
                <button className="link-btn" onClick={() => { setDeleting(false); setConfirm(''); }}>annuler</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ----- Réglages -----
const SettingsView = ({ settings, me, run, onMeChange, notify }) => {
  const [free, setFree] = useState(settings.free_limits || { maxProjects: 3, scene3d: false, forecastDays: 3 });
  const [inv, setInv] = useState(settings.invite_defaults || { trialDays: 90, founderSeats: 50, founderPrice: '12,99 $ par mois' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (settings.free_limits) setFree(settings.free_limits); if (settings.invite_defaults) setInv(settings.invite_defaults); }, [settings]);

  const addPasskey = async () => {
    setBusy(true);
    const { error } = await supabaseClient.auth.registerPasskey();
    if (error) { notify(error.message, true); setBusy(false); return; }
    if (me.passkey_required) { notify('Clé ajoutée'); onMeChange(); }
    else await lockWithPasskey(notify, onMeChange);
    setBusy(false);
  };
  const removePasskey = async (id) => {
    try { await api('passkey_delete', { passkey_id: id }); notify('Clé retirée'); onMeChange(); } catch (e) { notify(e.message, true); }
  };

  return (
    <>
      <div className="panel">
        <div className="t-section">CE QUE GARDE UN COMPTE GRATUIT</div>
        <div className="t-muted" style={{ marginBottom: '16px' }}>Après la période gratuite, sans abonnement. Lu par l'application au démarrage.</div>
        <div className="panel-grid">
          <div className="field"><label>PROJETS ACTIFS AU MAXIMUM</label><input className="input" type="number" min="0" value={free.maxProjects ?? 3} onChange={e => setFree({ ...free, maxProjects: Number(e.target.value) })} /></div>
          <div className="field"><label>JOURS DE PRÉVISION</label><input className="input" type="number" min="1" max="10" value={free.forecastDays ?? 3} onChange={e => setFree({ ...free, forecastDays: Number(e.target.value) })} /></div>
          <div className="field"><label>VUE 3D</label><label className="check"><input type="checkbox" checked={!!free.scene3d} onChange={e => setFree({ ...free, scene3d: e.target.checked })} />Offerte au gratuit</label></div>
        </div>
        <div className="panel-actions"><button className="btn btn-primary" onClick={() => run('setting', { key: 'free_limits', value: free }, 'Réglages du gratuit enregistrés')}>ENREGISTRER</button></div>
      </div>

      <div className="panel">
        <div className="t-section">INVITATIONS PAR DÉFAUT</div>
        <div className="panel-grid">
          <div className="field"><label>JOURS GRATUITS</label><input className="input" type="number" min="0" value={inv.trialDays ?? 90} onChange={e => setInv({ ...inv, trialDays: Number(e.target.value) })} /></div>
          <div className="field"><label>PLACES FONDATEUR</label><input className="input" type="number" min="0" value={inv.founderSeats ?? 50} onChange={e => setInv({ ...inv, founderSeats: Number(e.target.value) })} /></div>
          <div className="field"><label>PRIX FONDATEUR (TEXTE)</label><input className="input" value={inv.founderPrice || ''} onChange={e => setInv({ ...inv, founderPrice: e.target.value })} /></div>
        </div>
        <div className="panel-actions"><button className="btn btn-primary" onClick={() => run('setting', { key: 'invite_defaults', value: inv }, 'Défauts d’invitation enregistrés')}>ENREGISTRER</button></div>
      </div>

      <div className="panel">
        <div className="t-section">FACE ID ET TOUCH ID</div>
        <div className="t-muted" style={{ marginBottom: '14px' }}>
          {me.passkey_required ? 'Dieu exige une clé d’accès pour entrer. Les clés se synchronisent entre tes appareils par le trousseau iCloud.' : 'Aucune clé enregistrée: le mot de passe suffit encore. À faire depuis dieu.meteoshoot.com.'}
        </div>
        {(me.passkeys || []).map(p => (
          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--line)', fontSize: '14px' }}>
            <div>{p.friendly_name || 'Clé d’accès'}<span className="t-muted" style={{ marginLeft: '12px' }}>ajoutée le {fmtDate(p.created_at)}{p.last_used_at ? `, utilisée ${relative(p.last_used_at)}` : ''}</span></div>
            <button className="btn btn-small btn-danger" onClick={() => removePasskey(p.id)}>RETIRER</button>
          </div>
        ))}
        <div className="panel-actions">
          <button className="btn" onClick={addPasskey} disabled={busy || !PASSKEY_OK_HOST}><FaceIcon />AJOUTER UNE CLÉ SUR CET APPAREIL</button>
          <span className="t-muted">Session actuelle: {me.via_passkey ? 'ouverte par clé d’accès' : 'ouverte par mot de passe'}</span>
        </div>
      </div>
    </>
  );
};

// ----- Journal -----
const ACTION_LABEL = { invite: 'Invitation', resend: 'Invitation renvoyée', update: 'Mise à jour', disable: 'Désactivé', enable: 'Réactivé', delete: 'Supprimé', setting: 'Réglage', passkey_on: 'Face ID activé', passkey_off: 'Face ID retiré', passkey_delete: 'Clé retirée' };
const LogView = () => {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('log', { limit: 200 }).then(r => setRows(r.log || [])).catch(() => setRows([])); }, []);
  return (
    <div>
      <div className="t-section">JOURNAL DES ACTIONS</div>
      {rows === null && <div className="t-muted">Chargement</div>}
      {rows && rows.length === 0 && <div className="t-muted">Rien encore.</div>}
      {rows && rows.map(r => (
        <div key={r.id} className="log-row">
          <div className="t-muted">{fmtDateTime(r.at)}</div>
          <div>{ACTION_LABEL[r.action] || r.action}</div>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.target_email || ''}</div>
          <div className="t-mono log-details">{r.details ? JSON.stringify(r.details) : ''}</div>
        </div>
      ))}
    </div>
  );
};

// ----- Revenus (fonction admin-revenue, Lemon Squeezy) -----
const RevenueView = () => {
  const [rev, setRev] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const res = await fetch(FN_REVENUE, { headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY } });
        if (!res.ok) throw new Error(`Lemon Squeezy injoignable (${res.status})`);
        setRev(await res.json());
      } catch (e) { setErr(e.message); }
    })();
  }, []);
  const money = (n) => new Intl.NumberFormat('fr-CA', { style: 'currency', currency: rev?.currency || 'CAD' }).format(n || 0);
  if (err) return <div className="t-muted">{err}</div>;
  if (!rev) return <div className="t-muted">Chargement</div>;
  return (
    <div>
      <div className="stats">
        <div className="stat-card"><div className="stat-number">{money(rev.total_revenue)}</div><div className="stat-label">REVENU TOTAL</div></div>
        <div className="stat-card"><div className="stat-number">{rev.active_subscriptions || 0}</div><div className="stat-label">ABONNEMENTS ACTIFS</div></div>
        <div className="stat-card"><div className="stat-number">{rev.total_orders || 0}</div><div className="stat-label">COMMANDES</div></div>
      </div>
      {(rev.orders || []).length > 0 && (
        <div>
          <div className="t-section">DERNIÈRES COMMANDES</div>
          {rev.orders.slice(0, 30).map((o, i) => (
            <div key={i} className="log-row" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.email}</div>
              <div className="t-mono">{money(o.total)}</div>
              <div style={{ color: o.status === 'paid' ? 'var(--teal)' : 'var(--amber)' }}>{(o.status || '').toUpperCase()}</div>
              <div className="t-muted">{fmtDate(o.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ===== Racine: session, droits, clé d'accès =====
const Root = () => {
  const [phase, setPhase] = useState('loading'); // loading | login | denied | passkey | ok
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { setPhase('login'); return; }
    try {
      const m = await api('me');
      setMe(m);
      setPhase(m.ok ? 'ok' : 'passkey');
    } catch (e) {
      if (e.status === 403 || e.status === 401) setPhase('denied'); else { setError(e.message); setPhase('denied'); }
    }
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((event) => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') check();
    });
    return () => subscription.unsubscribe();
  }, [check]);

  if (phase === 'loading') return <div style={{ position: 'fixed', inset: 0, background: '#e8e6e1' }} />;
  if (phase === 'login') return <LoginGate onDone={check} />;
  if (phase === 'denied') {
    return (
      <Gate title="DIEU">
        <div className="gate-text">{error || 'Rien pour toi ici.'}</div>
        <button className="btn" onClick={signOut}>SORTIR</button>
      </Gate>
    );
  }
  if (phase === 'passkey') {
    return (
      <Gate title="DIEU">
        <div className="gate-text">Dieu est verrouillé par Face ID. Le mot de passe ne suffit plus.</div>
        <button className="btn btn-primary btn-face" onClick={async () => { await supabaseClient.auth.signOut(); const { error: err } = await supabaseClient.auth.signInWithPasskey(); if (err) setError(err.message); else check(); }}><FaceIcon />ENTRER AVEC FACE ID</button>
        {error && <div className="gate-error">{error}</div>}
        <button className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={signOut}>sortir</button>
      </Gate>
    );
  }
  return <Dashboard me={me} onMeChange={check} />;
};

createRoot(document.getElementById('root')).render(<Root />);
