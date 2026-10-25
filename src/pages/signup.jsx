// Page « Accepter l'invitation » (25 octobre 2026). MeteoShoot est offert sur invitation: cette page reçoit le lien du
// courriel d'invitation (Supabase ouvre la session et ramène ici avec type=invite), fait choisir le mot de passe,
// confirme le nom et l'organisation, puis ouvre l'application. Sans session d'invitation, elle dit simplement que
// l'application est sur invitation.
import './signup.css';
import '@fontsource/montserrat/300.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../shared/config.js';
import { TRANSLATIONS, getDefaultLang } from '../shared/translations.js';

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
const TBL_PROFILES = isDev ? 'user_profiles_dev' : 'user_profiles';

// Le fragment de l'adresse dit d'où l'on vient (lien d'invitation, lien expiré). Lu une fois, avant que Supabase l'efface.
const HASH = window.location.hash || '';
const FROM_INVITE = /type=invite/.test(HASH) || /type=invite/.test(window.location.search);
const LINK_ERROR = /error=/.test(HASH) ? decodeURIComponent((HASH.match(/error_description=([^&]*)/) || [])[1] || 'expired').replace(/\+/g, ' ') : '';

// ===== i18n =====
const LangContext = createContext();
const useLang = () => useContext(LangContext);
const LangProvider = ({ children }) => {
  const [lang, setLang] = useState(getDefaultLang());
  const switchLang = (l) => { setLang(l); localStorage.setItem('sp-lang', l); };
  const t = (key) => { const tr = TRANSLATIONS[lang]; return (tr && tr[key] !== undefined) ? tr[key] : (TRANSLATIONS.fr[key] || key); };
  return <LangContext.Provider value={{ lang, switchLang, t }}>{children}</LangContext.Provider>;
};
const LangToggle = () => {
  const { lang, switchLang } = useLang();
  return (
    <div className="lang-toggle">
      <button className={lang === 'fr' ? 'active' : ''} onClick={() => switchLang('fr')}>FR</button>
      <button className={lang === 'en' ? 'active' : ''} onClick={() => switchLang('en')}>EN</button>
    </div>
  );
};

// ===== Éléments de formulaire (même verre que la page de connexion) =====
const GlassInput = ({ children, mb, label }) => (
  <div style={{ marginBottom: mb || '13px' }}>
    {label && (
      <div style={{ fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, fontSize: '11px', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '4px', paddingLeft: '14px' }}>{label}</div>
    )}
    <div style={{ position: 'relative', overflow: 'hidden', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: 'none', borderRadius: '0', padding: '2px' }}>
      <div style={{ position: 'absolute', top: '-200px', left: '-600px', width: '800px', height: '800px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.08) 40%, transparent 70%)', pointerEvents: 'none' }} />
      {children}
    </div>
  </div>
);
const inputStyle = {
  background: 'transparent', border: 'none', outline: 'none', color: '#ffffff', fontSize: '21px', width: '100%',
  padding: '6px 14px', fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, boxSizing: 'border-box', position: 'relative', zIndex: 1
};
const textStyle = { fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, fontSize: '14px', color: 'rgba(255,255,255,0.6)', lineHeight: '1.6', letterSpacing: '0.02em' };

const Halo = ({ isMob }) => (
  <div style={{
    position: 'absolute', top: isMob ? 'calc(46% - 80px)' : 'calc(46% - 150px)', left: isMob ? 'calc(50% - 100px)' : 'calc(50% - 200px)',
    transform: 'translate(-50%, -50%) translateZ(0)', width: isMob ? '900px' : '1800px', height: isMob ? '900px' : '1800px', borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(170,215,208,0.4) 0%, rgba(150,200,195,0.08) 30%, transparent 55%)',
    filter: 'blur(60px)', pointerEvents: 'none', zIndex: 1, animation: 'splashHaloOrg 7s ease-in-out infinite, splashHaloBreathe 2.8s ease-in-out infinite'
  }} />
);
const Logo = () => (
  <div className="splash-logo-area" style={{ marginBottom: '25px' }}>
    <img className="splash-flare" src="../imgProjet/splash-o.png" alt="" />
    <img className="splash-logo-img" src="../imgProjet/splash-typoMeteoshoot.png" alt="meteoshoot" />
  </div>
);
const Page = ({ isMob, children }) => (
  <div style={{ position: 'fixed', inset: 0, background: '#181b1e', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflowX: 'hidden', overflowY: 'auto' }}>
    <Halo isMob={isMob} />
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', position: 'relative', zIndex: 10 }}>
      <Logo />
      <div style={{ width: isMob ? '300px' : '360px' }}>{children}</div>
    </div>
    <LangToggle />
  </div>
);

// ===== ACCEPTER L'INVITATION =====
const AcceptInvitation = () => {
  const { t, lang, switchLang } = useLang();
  const [state, setState] = useState('checking'); // checking | invite | closed | expired
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [fullName, setFullName] = useState('');
  const [organization, setOrganization] = useState('');
  const [sector, setSector] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const isMob = window.innerWidth < 768;

  useEffect(() => {
    if (LINK_ERROR) { setState('expired'); return; }
    let settled = false;
    const settle = async (session) => {
      if (settled) return;
      settled = true;
      if (!session?.user) { setState('closed'); return; }
      const u = session.user;
      const meta = u.user_metadata || {};
      // Membre déjà installé (mot de passe choisi, déjà revenu): droit à l'application.
      if (!FROM_INVITE && !meta.invited) { window.location.href = '/index.html'; return; }
      if (meta.lang === 'en' || meta.lang === 'fr') switchLang(meta.lang);
      setUser(u);
      setFullName(meta.full_name || '');
      setOrganization(meta.organization || '');
      const { data } = await supabaseClient.from(TBL_PROFILES).select('*').eq('user_id', u.id).maybeSingle();
      setProfile(data || null);
      if (data?.full_name && !meta.full_name) setFullName(data.full_name);
      if (data?.organization && !meta.organization) setOrganization(data.organization);
      if (data?.sector) setSector(data.sector);
      setState('invite');
    };
    // Supabase lit le fragment de l'adresse et ouvre la session; on attend ce signal, sinon la session déjà en place.
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') settle(session);
    });
    const timer = setTimeout(() => supabaseClient.auth.getSession().then(({ data: { session } }) => settle(session)), 1500);
    return () => { subscription.unsubscribe(); clearTimeout(timer); };
  }, []);

  const handleSubmit = async () => {
    if (!password || sending) return;
    setError('');
    if (password.length < 8) { setError(lang === 'en' ? 'At least 8 characters for the password.' : 'Au moins 8 caractères pour le mot de passe.'); return; }
    setSending(true);
    try {
      const { error: err } = await supabaseClient.auth.updateUser({
        password,
        data: { full_name: fullName || null, organization: organization || null, sector: sector || null, lang, invited: false, accepted_at: new Date().toISOString() }
      });
      if (err) { setError(err.message || t('signupError')); setSending(false); return; }
      // Profil (colonnes que le client a le droit d'écrire: nom, organisation, secteur).
      await supabaseClient.from(TBL_PROFILES).update({ full_name: fullName || null, organization: organization || null, sector: sector || null }).eq('user_id', user.id);
      localStorage.setItem('sp-lang', lang);
      const root = document.getElementById('root');
      root.style.transition = 'opacity 0.3s ease';
      root.style.opacity = '0';
      setTimeout(() => { window.location.href = '/index.html'; }, 320);
    } catch (e) {
      setError(t('signupError'));
      setSending(false);
    }
  };

  if (state === 'checking') return <div style={{ position: 'fixed', inset: 0, background: '#181b1e' }} />;

  if (state === 'closed' || state === 'expired') {
    return (
      <Page isMob={isMob}>
        <div style={{ ...textStyle, padding: '0 14px', animation: 'fadeInUp 0.6s ease-out forwards' }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: 300, fontSize: '26px', color: '#ffffff', letterSpacing: '0.08em', marginBottom: '14px' }}>
            {t('inviteOnly').toUpperCase()}
          </div>
          <div>{state === 'expired' ? t('inviteExpired') : t('inviteNoSession')}</div>
          <a href="login.html" style={{ display: 'inline-block', marginTop: '28px', color: 'rgba(170,215,208,0.6)', textDecoration: 'none', fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, fontSize: '14px' }}>
            {t('backToLogin')}
          </a>
        </div>
      </Page>
    );
  }

  const firstName = (fullName || '').trim().split(/\s+/)[0] || '';
  return (
    <Page isMob={isMob}>
      <div style={{ padding: '0 14px', marginBottom: '22px' }}>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: 300, fontSize: '30px', color: '#ffffff', letterSpacing: '0.08em', lineHeight: 1 }}>
          {t('inviteWelcome').toUpperCase()}{firstName ? ` ${firstName.toUpperCase()}` : ''}
        </div>
        <div style={{ ...textStyle, marginTop: '10px' }}>{t('inviteIntro')}</div>
        {profile?.is_founder && (
          <div style={{ ...textStyle, color: 'rgba(170,215,208,0.75)', marginTop: '8px' }}>{t('inviteFounderNote')}</div>
        )}
      </div>

      <GlassInput label={t('email')}>
        <input type="email" value={user?.email || ''} readOnly style={{ ...inputStyle, color: 'rgba(255,255,255,0.5)' }} className="login-input" />
      </GlassInput>
      <GlassInput label={t('fullName')}>
        <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" style={inputStyle} className="login-input" />
      </GlassInput>
      <GlassInput label={t('organization')}>
        <input type="text" value={organization} onChange={e => setOrganization(e.target.value)} autoComplete="organization" style={inputStyle} className="login-input" />
      </GlassInput>
      <GlassInput label={t('sector')}>
        <select value={sector} onChange={e => setSector(e.target.value)} className="login-input"
          style={{ ...inputStyle, appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none', cursor: 'pointer', color: sector ? '#ffffff' : 'rgba(255,255,255,0.5)' }}>
          <option value="" style={{ background: '#1e2224', color: 'rgba(255,255,255,0.5)' }}>-</option>
          {t('sectorOptions').map(opt => <option key={opt} value={opt} style={{ background: '#1e2224', color: '#ffffff' }}>{opt}</option>)}
        </select>
      </GlassInput>
      <GlassInput label={t('password')} mb="16px">
        <div style={{ position: 'relative' }}>
          <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()} autoComplete="new-password" autoFocus
            style={{ ...inputStyle, paddingRight: '44px' }} className="login-input" />
          <button type="button" onClick={() => setShowPassword(!showPassword)}
            style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', zIndex: 2 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={showPassword ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {showPassword ? (<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>) : (<><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>)}
            </svg>
          </button>
        </div>
      </GlassInput>

      {error && <div style={{ ...textStyle, color: 'rgba(255,255,255,0.4)', padding: '0 14px', marginBottom: '8px' }}>{error}</div>}

      <button onClick={handleSubmit} disabled={sending || !password} className="login-btn"
        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px', width: '100%', padding: '4px 2px' }}>
        <span style={{ fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, fontSize: '21px', color: '#ffffff', letterSpacing: '0.02em' }}>
          {sending ? t('inviteEntering') : t('inviteEnter')}
        </span>
        <span style={{ color: '#ffffff', fontSize: '21px', fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif", fontWeight: 300, position: 'relative', top: '2px' }}>&#8594;</span>
      </button>
    </Page>
  );
};

createRoot(document.getElementById('root')).render(<LangProvider><AcceptInvitation /></LangProvider>);
