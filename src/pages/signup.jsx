import './signup.css';
import '@fontsource/montserrat/300.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY, publicOrigin } from '../shared/config.js';
import { TRANSLATIONS, getDefaultLang } from '../shared/translations.js';


// ===== SUPABASE =====
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== i18n CONTEXT =====
const LangContext = createContext();
const useLang = () => useContext(LangContext);

const LangProvider = ({ children }) => {
  const [lang, setLang] = useState(getDefaultLang());

  const switchLang = (l) => {
    setLang(l);
    localStorage.setItem('sp-lang', l);
  };

  const t = (key) => {
    const tr = TRANSLATIONS[lang];
    return (tr && tr[key] !== undefined) ? tr[key] : (TRANSLATIONS.fr[key] || key);
  };

  return (
    <LangContext.Provider value={{ lang, switchLang, t }}>
      {children}
    </LangContext.Provider>
  );
};

// ===== LANG TOGGLE =====
const LangToggle = () => {
  const { lang, switchLang } = useLang();
  return (
    <div className="lang-toggle">
      <button
        className={lang === 'fr' ? 'active' : ''}
        onClick={() => switchLang('fr')}
      >FR</button>
      <button
        className={lang === 'en' ? 'active' : ''}
        onClick={() => switchLang('en')}
      >EN</button>
    </div>
  );
};

// ===== EMAIL ICON SVG =====
const EmailIcon = () => (
  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(170,215,208,0.6)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2"/>
    <polyline points="22,4 12,13 2,4"/>
  </svg>
);

// Glassmorphic input wrapper (outside component to avoid re-mount on re-render)
const GlassInput = ({ children, mb, label }) => (
  <div style={{ marginBottom: mb || '13px' }}>
    {label && (
      <div style={{
        fontFamily: "'Avenir', 'Montserrat', sans-serif",
        fontWeight: 300, fontSize: '11px', color: 'rgba(255,255,255,0.35)',
        letterSpacing: '0.08em', textTransform: 'uppercase',
        marginBottom: '4px', paddingLeft: '14px'
      }}>{label}</div>
    )}
    <div style={{
      position: 'relative', overflow: 'hidden',
      backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      border: 'none', borderRadius: '0', padding: '2px'
    }}>
      <div style={{
        position: 'absolute', top: '-200px', left: '-600px',
        width: '800px', height: '800px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.08) 40%, transparent 70%)',
        pointerEvents: 'none'
      }} />
      {children}
    </div>
  </div>
);

const inputStyle = {
  background: 'transparent', border: 'none', outline: 'none',
  color: '#ffffff', fontSize: '21px', width: '100%',
  padding: '6px 14px', fontFamily: "'Avenir', 'Montserrat', sans-serif",
  fontWeight: 300, boxSizing: 'border-box', position: 'relative', zIndex: 1
};

// ===== SIGNUP SCREEN =====
const SignupScreen = () => {
  const { t, lang } = useLang();
  const [fullName, setFullName] = useState('');
  const [organization, setOrganization] = useState('');
  const [sector, setSector] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const isMob = window.innerWidth < 768;

  // Check if already authenticated -> redirect
  useEffect(() => {
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        window.location.href = '/index.html';
      } else {
        setCheckingAuth(false);
      }
    });
  }, []);

  const handleSubmit = async () => {
    if (!email || !password) return;

    setError('');

    // Validate password length
    if (password.length < 6) {
      setError(t('passwordTooShort'));
      return;
    }

    setSending(true);

    try {
      const { data, error: signUpError } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: publicOrigin() + '/index.html',
          data: {
            full_name: fullName || null,
            organization: organization || null,
            sector: sector || null,
            lang: lang
          }
        }
      });

      if (signUpError) {
        setError(signUpError.message || t('signupError'));
        setSending(false);
      } else if (data?.user?.identities?.length === 0) {
        // Email already exists: Supabase returns empty identities
        setError(t('emailAlreadyExists'));
        setSending(false);
      } else {
        setSuccess(true);
        setSending(false);
      }
    } catch (e) {
      setError(t('signupError'));
      setSending(false);
    }
  };

  // Show nothing while checking auth
  if (checkingAuth) {
    return <div style={{ position: 'fixed', inset: 0, background: '#181b1e' }} />;
  }

  // ===== SUCCESS / CONFIRMATION SCREEN =====
  if (success) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#181b1e',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden'
      }}>
        {/* Halo glow */}
        <div style={{
          position: 'absolute',
          top: isMob ? 'calc(46% - 80px)' : 'calc(46% - 150px)',
          left: isMob ? 'calc(50% - 100px)' : 'calc(50% - 200px)',
          transform: 'translate(-50%, -50%) translateZ(0)',
          width: isMob ? '900px' : '1800px',
          height: isMob ? '900px' : '1800px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(170,215,208,0.4) 0%, rgba(150,200,195,0.08) 30%, transparent 55%)',
          filter: 'blur(60px)', pointerEvents: 'none', zIndex: 1,
          animation: 'splashHaloOrg 7s ease-in-out infinite, splashHaloBreathe 2.8s ease-in-out infinite'
        }} />

        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          position: 'relative', zIndex: 10,
          animation: 'fadeInUp 0.6s ease-out forwards'
        }}>
          <EmailIcon />
          <div style={{
            fontFamily: "'Avenir', 'Montserrat', sans-serif",
            fontWeight: 300, fontSize: '14px',
            color: 'rgba(255,255,255,0.6)',
            marginTop: '20px', textAlign: 'center',
            maxWidth: '300px', lineHeight: '1.6',
            letterSpacing: '0.02em'
          }}>
            {t('emailSent')}
          </div>
          <div style={{
            fontFamily: "'Avenir', 'Montserrat', sans-serif",
            fontWeight: 300, fontSize: '14px',
            color: 'rgba(255,255,255,0.4)',
            marginTop: '10px', textAlign: 'center',
            maxWidth: '300px', lineHeight: '1.6',
            letterSpacing: '0.02em'
          }}>
            {t('checkEmail')}
          </div>
          <a
            href="login.html"
            style={{
              fontFamily: "'Avenir', 'Montserrat', sans-serif",
              fontWeight: 300, fontSize: '14px',
              color: 'rgba(170,215,208,0.5)',
              marginTop: '30px', textDecoration: 'none',
              letterSpacing: '0.02em',
              transition: 'color 0.2s ease'
            }}
            onMouseEnter={e => e.target.style.color = 'rgba(170,215,208,0.8)'}
            onMouseLeave={e => e.target.style.color = 'rgba(170,215,208,0.5)'}
          >
            {t('backToLogin')}
          </a>
        </div>

        <LangToggle />
      </div>
    );
  }

  // ===== SIGNUP FORM =====
  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#181b1e',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden'
    }}>
      {/* Halo glow -- same as splash */}
      <div style={{
        position: 'absolute',
        top: isMob ? 'calc(46% - 80px)' : 'calc(46% - 150px)',
        left: isMob ? 'calc(50% - 100px)' : 'calc(50% - 200px)',
        transform: 'translate(-50%, -50%) translateZ(0)',
        width: isMob ? '900px' : '1800px',
        height: isMob ? '900px' : '1800px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(170,215,208,0.4) 0%, rgba(150,200,195,0.08) 30%, transparent 55%)',
        filter: 'blur(60px)', pointerEvents: 'none', zIndex: 1,
        animation: 'splashHaloOrg 7s ease-in-out infinite, splashHaloBreathe 2.8s ease-in-out infinite'
      }} />

      {/* Logo + Form wrapper -- left-aligned together */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        {/* Logo + flare -- exact same as splash */}
        <div className="splash-logo-area" style={{ marginBottom: '25px' }}>
          <img className="splash-flare" src="../imgProjet/splash-o.png" alt="" />
          <img className="splash-logo-img" src="../imgProjet/splash-typoMeteoshoot.png" alt="meteoshoot" />
        </div>

        {/* Form */}
        <div style={{ width: isMob ? '300px' : '360px', position: 'relative', zIndex: 10 }}>
          {/* Name */}
          <GlassInput label={t('fullName')}>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              autoComplete="name"
              style={inputStyle}
              className="login-input"
            />
          </GlassInput>

          {/* Organization */}
          <GlassInput label={t('organization')}>
            <input
              type="text"
              value={organization}
              onChange={e => setOrganization(e.target.value)}
              autoComplete="organization"
              style={inputStyle}
              className="login-input"
            />
          </GlassInput>

          {/* Sector dropdown */}
          <GlassInput label={t('sector')}>
            <select
              value={sector}
              onChange={e => setSector(e.target.value)}
              style={{ ...inputStyle, appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none', cursor: 'pointer', color: sector ? '#ffffff' : 'rgba(255,255,255,0.5)' }}
              className="login-input"
            >
              <option value="" style={{ background: '#1e2224', color: 'rgba(255,255,255,0.5)' }}>-</option>
              {t('sectorOptions').map(opt => (
                <option key={opt} value={opt} style={{ background: '#1e2224', color: '#ffffff' }}>{opt}</option>
              ))}
            </select>
          </GlassInput>

          {/* Email */}
          <GlassInput label={t('email')}>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              style={inputStyle}
              className="login-input"
            />
          </GlassInput>

          {/* Password */}
          <GlassInput label={t('password')} mb="16px">
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                autoComplete="new-password"
                style={{ ...inputStyle, paddingRight: '44px' }}
                className="login-input"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px', zIndex: 2 }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={showPassword ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  {showPassword ? (
                    <>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </>
                  ) : (
                    <>
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </>
                  )}
                </svg>
              </button>
            </div>
          </GlassInput>

          {/* Error message */}
          {error && (
            <div style={{
              fontFamily: "'Avenir', 'Montserrat', sans-serif",
              fontWeight: 300, fontSize: '14px',
              color: 'rgba(255,255,255,0.4)',
              whiteSpace: 'nowrap',
              padding: '0 14px', marginBottom: '8px'
            }}>
              {error}
            </div>
          )}

          {/* Submit button */}
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
            <span style={{
              fontFamily: "'Avenir', 'Montserrat', sans-serif",
              fontWeight: 300, fontSize: '21px',
              color: '#ffffff', letterSpacing: '0.02em'
            }}>
              {sending ? t('creatingAccount') : t('createAccount')}
            </span>
            <span style={{
              color: '#ffffff', fontSize: '21px',
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
              fontWeight: 300, position: 'relative', top: '2px'
            }}>&#8594;</span>
          </button>

          {/* Link to login */}
          <div style={{
            marginTop: '20px', padding: '0 2px',
            display: 'flex', alignItems: 'center', gap: '6px'
          }}>
            <span style={{
              fontFamily: "'Avenir', 'Montserrat', sans-serif",
              fontWeight: 300, fontSize: '14px',
              color: 'rgba(255,255,255,0.3)',
              letterSpacing: '0.02em'
            }}>
              {t('hasAccount')}
            </span>
            <a
              href="login.html"
              style={{
                fontFamily: "'Avenir', 'Montserrat', sans-serif",
                fontWeight: 300, fontSize: '14px',
                color: 'rgba(255,255,255,0.5)',
                textDecoration: 'none',
                letterSpacing: '0.02em',
                transition: 'color 0.2s ease'
              }}
              onMouseEnter={e => e.target.style.color = 'rgba(255,255,255,0.8)'}
              onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.5)'}
            >
              {t('login')}
            </a>
          </div>
        </div>
      </div>

      {/* Version badge */}
      <div style={{
        position: 'absolute', bottom: '40px', left: '50%',
        transform: 'translateX(-50%)', zIndex: 2, textAlign: 'center'
      }}>
        <div style={{
          fontSize: '12px', color: 'rgba(255,255,255,0.2)',
          fontFamily: 'monospace', letterSpacing: '0.05em'
        }}>
          {window.isDev ? 'DEV' : ''}
        </div>
      </div>

      <LangToggle />
    </div>
  );
};

// ===== APP ROOT =====
const App = () => (
  <LangProvider>
    <SignupScreen />
  </LangProvider>
);

createRoot(document.getElementById('root')).render(<App />);
