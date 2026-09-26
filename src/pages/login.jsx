import './login.css';
import '@fontsource/montserrat/300.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../shared/config.js';
import { TRANSLATIONS, getDefaultLang } from '../shared/translations.js';


// ===== SUPABASE =====
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== REDIRECT HELPER =====
const getRedirectUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get('redirect');
  // Only allow same-origin relative paths for safety
  if (redirect && redirect.startsWith('/')) return redirect;
  return '/index.html';
};

// ===== i18n CONTEXT =====
const LangContext = createContext();

const LangProvider = ({ children }) => {
  const [lang, setLang] = useState(getDefaultLang());

  const switchLang = (newLang) => {
    setLang(newLang);
    localStorage.setItem('sp-lang', newLang);
  };

  const translate = (key) => {
    const tr = TRANSLATIONS[lang];
    return (tr && tr[key] !== undefined) ? tr[key] : (TRANSLATIONS.fr[key] || key);
  };

  return (
    <LangContext.Provider value={{ lang, setLang: switchLang, t: translate }}>
      {children}
    </LangContext.Provider>
  );
};

const useLang = () => useContext(LangContext);

// ===== MOBILE DETECTION =====
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
};

// ===== LOGIN SCREEN =====
const LoginScreen = () => {
  const { t, lang } = useLang();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const [view, setView] = useState('login'); // 'login' | 'forgot'
  const [resetEmail, setResetEmail] = useState('');
  const [resetSending, setResetSending] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState(false);

  const isMob = useIsMobile();

  // Check if already authenticated on load
  useEffect(() => {
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        window.location.href = getRedirectUrl();
      }
    });
  }, []);

  const handleSubmit = async () => {
    if (!email || !password) return;
    setSending(true);
    setError(false);
    try {
      const { error: err } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (err) {
        setError(true);
        setSending(false);
      } else {
        window.location.href = getRedirectUrl();
      }
    } catch (e) {
      setError(true);
      setSending(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetEmail) return;
    setResetSending(true);
    setResetError(false);
    setResetSent(false);
    try {
      const { error: err } = await supabaseClient.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: window.location.origin + '/index.html'
      });
      if (err) {
        setResetError(true);
      } else {
        setResetSent(true);
      }
    } catch (e) {
      setResetError(true);
    }
    setResetSending(false);
  };

  if (view === 'forgot') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#181b1e', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {/* Halo glow */}
        <div className="splash-halo-el" style={{
          position: 'absolute', top: isMob ? 'calc(46% - 80px)' : 'calc(46% - 150px)', left: isMob ? 'calc(50% - 100px)' : 'calc(50% - 200px)', transform: 'translate(-50%, -50%) translateZ(0)',
          width: isMob ? '900px' : '1800px', height: isMob ? '900px' : '1800px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(170,215,208,0.4) 0%, rgba(150,200,195,0.08) 30%, transparent 55%)',
          filter: 'blur(60px)', pointerEvents: 'none', zIndex: 1,
          animation: 'splashHaloOrg 20s ease-in-out infinite'
        }}/>
        {/* Logo + Form */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          {/* Logo + flare */}
          <div className="splash-logo-area" style={{ marginBottom: '25px' }}>
            <img className="splash-flare" src="../imgProjet/splash-o.png" alt="" />
            <img className="splash-logo-img" src="../imgProjet/splash-typoMeteoshoot.png" alt="meteoshoot" />
          </div>
          {/* Reset Form */}
          <div style={{ width: isMob ? '300px' : '360px', position: 'relative', zIndex: 10 }}>
            <div style={{
              position: 'relative', overflow: 'hidden',
              backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
              border: 'none',
              borderRadius: '0', padding: '2px', marginBottom: '13px'
            }}>
              <div style={{ position: 'absolute', top: '-200px', left: '-600px', width: '800px', height: '800px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.08) 40%, transparent 70%)', pointerEvents: 'none' }} />
              <input
                type="email"
                value={resetEmail}
                onChange={e => setResetEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleResetPassword()}
                placeholder={t('email')}
                autoComplete="email"
                style={{ background: 'transparent', border: 'none', outline: 'none', color: '#ffffff', fontSize: '21px', width: '100%', padding: '6px 14px', fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, boxSizing: 'border-box', position: 'relative', zIndex: 1 }}
                className="login-input"
              />
            </div>

            {resetSent && (
              <div style={{ fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, fontSize: '14px', color: 'rgba(170,215,208,0.6)', whiteSpace: 'nowrap', padding: '0 14px', marginBottom: '8px' }}>
                {t('resetSent')}
              </div>
            )}
            {resetError && (
              <div style={{ fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, fontSize: '14px', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap', padding: '0 14px', marginBottom: '8px' }}>
                {t('loginError')}
              </div>
            )}

            <button
              onClick={handleResetPassword}
              disabled={resetSending || !resetEmail}
              className="login-btn"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px',
                width: '100%', padding: '4px 2px',
                opacity: 1,
                transition: 'opacity 0.2s, text-shadow 0.3s'
              }}
            >
              <span style={{ fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, fontSize: '21px', color: '#ffffff', letterSpacing: '0.02em' }}>
                {resetSending ? '...' : t('resetPassword')}
              </span>
              <span style={{ color: '#ffffff', fontSize: '21px', fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif", fontWeight: 300, position: 'relative', top: '2px' }}>{'\u2192'}</span>
            </button>

            {/* Back to login */}
            <div style={{ marginTop: '20px', padding: '0 2px' }}>
              <button
                onClick={() => { setView('login'); setResetSent(false); setResetError(false); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, fontSize: '13px', color: 'rgba(255,255,255,0.3)', padding: 0, transition: 'color 0.2s' }}
                onMouseEnter={e => e.target.style.color = 'rgba(255,255,255,0.5)'}
                onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.3)'}
              >
                {t('backToLogin')}
              </button>
            </div>
          </div>
        </div>
        {/* Dev indicator */}
        <div style={{ position: 'absolute', bottom: '40px', left: '50%', transform: 'translateX(-50%)', zIndex: 2, textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', letterSpacing: '0.05em' }}>{window.isDev ? 'DEV' : ''}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#181b1e', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {/* Halo glow -- same as splash */}
      <div className="splash-halo-el" style={{
        position: 'absolute', top: isMob ? 'calc(46% - 80px)' : 'calc(46% - 150px)', left: isMob ? 'calc(50% - 100px)' : 'calc(50% - 200px)', transform: 'translate(-50%, -50%) translateZ(0)',
        width: isMob ? '900px' : '1800px', height: isMob ? '900px' : '1800px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(170,215,208,0.4) 0%, rgba(150,200,195,0.08) 30%, transparent 55%)',
        filter: 'blur(60px)', pointerEvents: 'none', zIndex: 1,
        animation: 'splashHaloOrg 20s ease-in-out infinite'
      }}/>
      {/* Logo + Form wrapper -- left-aligned together */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        {/* Logo + flare -- exact same as splash */}
        <div className="splash-logo-area" style={{ marginBottom: '25px' }}>
          <img className="splash-flare" src="../imgProjet/splash-o.png" alt="" />
          <img className="splash-logo-img" src="../imgProjet/splash-typoMeteoshoot.png" alt="meteoshoot" />
        </div>
        {/* Form */}
        <div style={{ width: isMob ? '300px' : '360px', position: 'relative', zIndex: 10 }}>
          {/* Email input */}
          <div style={{
            position: 'relative', overflow: 'hidden',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            border: 'none',
            borderRadius: '0', padding: '2px', marginBottom: '13px'
          }}>
            <div style={{ position: 'absolute', top: '-200px', left: '-600px', width: '800px', height: '800px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.08) 40%, transparent 70%)', pointerEvents: 'none' }} />
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t('email')}
              autoComplete="email"
              style={{ background: 'transparent', border: 'none', outline: 'none', color: '#ffffff', fontSize: '21px', width: '100%', padding: '6px 14px', fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, boxSizing: 'border-box', position: 'relative', zIndex: 1 }}
              className="login-input"
            />
          </div>
          {/* Password input */}
          <div style={{
            position: 'relative', overflow: 'hidden',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            border: 'none',
            borderRadius: '0', padding: '2px', marginBottom: '16px'
          }}>
            <div style={{ position: 'absolute', top: '-200px', left: '-600px', width: '800px', height: '800px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.08) 40%, transparent 70%)', pointerEvents: 'none' }} />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder={t('password')}
              autoComplete="current-password"
              style={{ background: 'transparent', border: 'none', outline: 'none', color: '#ffffff', fontSize: '21px', width: '100%', padding: '6px 14px', fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, boxSizing: 'border-box', position: 'relative', zIndex: 1 }}
              className="login-input"
            />
          </div>
          {/* Error message */}
          {error && (
            <div style={{ fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, fontSize: '14px', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap', padding: '0 14px', marginBottom: '8px' }}>
              {t('loginError')}
            </div>
          )}
          {/* Login button */}
          <button
            onClick={handleSubmit}
            disabled={sending || !email || !password}
            className="login-btn"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px',
              width: '100%', padding: '4px 2px',
              opacity: 1,
              transition: 'opacity 0.2s, text-shadow 0.3s'
            }}
          >
            <span style={{ fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, fontSize: '21px', color: '#ffffff', letterSpacing: '0.02em' }}>
              {sending ? t('loginLoading') : t('login')}
            </span>
            <span style={{ color: '#ffffff', fontSize: '21px', fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif", fontWeight: 300, position: 'relative', top: '2px' }}>{'\u2192'}</span>
          </button>

          {/* Forgot password & Signup - single line */}
          <div style={{ marginTop: '200px', padding: '0 2px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', whiteSpace: 'nowrap' }}>
            <button
              onClick={() => { setView('forgot'); setResetEmail(email); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, fontSize: '12px', color: '#546262', padding: 0, transition: 'color 0.2s', whiteSpace: 'nowrap' }}
              onMouseEnter={e => e.target.style.color = '#849898'}
              onMouseLeave={e => e.target.style.color = '#546262'}
            >
              {t('forgotPassword')}
            </button>
            <span style={{ color: '#546262', fontSize: '12px' }}>|</span>
            <span style={{ fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, fontSize: '12px', color: '#546262', whiteSpace: 'nowrap' }}>
              {t('noAccount')}{' '}
              <a
                href="signup.html"
                style={{ fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, fontSize: '12px', color: '#849898', textDecoration: 'none', transition: 'color 0.2s' }}
                onMouseEnter={e => e.target.style.color = '#b0c4c4'}
                onMouseLeave={e => e.target.style.color = '#849898'}
              >
                {t('signup')}
              </a>
            </span>
          </div>
        </div>
      </div>
      {/* Dev indicator */}
      <div style={{ position: 'absolute', bottom: '40px', left: '50%', transform: 'translateX(-50%)', zIndex: 2, textAlign: 'center' }}>
        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', letterSpacing: '0.05em' }}>{window.isDev ? 'DEV' : ''}</div>
      </div>
    </div>
  );
};

// ===== LANGUAGE TOGGLE =====
const LanguageToggle = () => {
  const { lang, setLang } = useLang();
  return (
    <div className="lang-toggle">
      <button
        className={lang === 'fr' ? 'active' : ''}
        onClick={() => setLang('fr')}
      >
        FR
      </button>
      <span style={{ color: 'rgba(255,255,255,0.15)', lineHeight: '28px' }}>|</span>
      <button
        className={lang === 'en' ? 'active' : ''}
        onClick={() => setLang('en')}
      >
        EN
      </button>
    </div>
  );
};

// ===== APP =====
const App = () => {
  return (
    <LangProvider>
      <LoginScreen />
      <LanguageToggle />
    </LangProvider>
  );
};

// ===== RENDER =====
const root = createRoot(document.getElementById('root'));
root.render(<App />);
