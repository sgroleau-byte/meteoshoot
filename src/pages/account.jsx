import './account.css';
import '@fontsource/montserrat/300.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY, openLemonCheckout } from '../shared/config.js';
import { TRANSLATIONS, getDefaultLang } from '../shared/translations.js';


// --- Supabase init ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const TBL_PROFILES = isDev ? 'user_profiles_dev' : 'user_profiles';

// --- Portail client Lemon Squeezy: adresse signée renvoyée par la fonction edge billing-portal ---
const BILLING_PORTAL_FN = `${SUPABASE_URL}/functions/v1/billing-portal`;
const fmtDate = (d, t) => { if (!d) return ''; const x = new Date(d); return `${x.getDate()} ${t('monthAbbrev')[x.getMonth()]} ${x.getFullYear()}`; };

// --- Lang context ---
const LangContext = createContext();
const useLang = () => useContext(LangContext);

const LangProvider = ({ children }) => {
  const [lang, setLangState] = useState(getDefaultLang());

  const setLang = (l) => {
    setLangState(l);
    localStorage.setItem('sp-lang', l);
  };

  const tr = (key) => {
    const dict = TRANSLATIONS[lang];
    return (dict && dict[key] !== undefined) ? dict[key] : (TRANSLATIONS.fr[key] || key);
  };

  return (
    <LangContext.Provider value={{ lang, setLang, t: tr }}>
      {children}
    </LangContext.Provider>
  );
};

// --- Tier helpers ---
const tierDotColor = (tier) => {
  switch (tier) {
    case 'shooter': return '#7dd3c6';
    case 'god': return '#ffffff';
    default: return '#7dd3c6';
  }
};

const tierTagline = (tier, t) => {
  switch (tier) {
    case 'shooter': return t('shooterTagline');
    case 'god': return t('godTagline');
    default: return t('freeTagline');
  }
};

const tierLabel = (tier, t) => {
  switch (tier) {
    case 'shooter': return t('shooterPlan');
    case 'god': return t('godPlan');
    default: return t('freePlan');
  }
};

const statusLabel = (status, t) => {
  switch (status) {
    case 'active': return t('active');
    case 'canceled': return t('canceled');
    case 'past_due': return t('pastDue');
    case 'expired': return t('expired');
    default: return t('active');
  }
};

const statusColor = (status) => {
  switch (status) {
    case 'active': return 'rgba(125,211,198,0.7)';
    case 'canceled': return 'rgba(255,255,255,0.35)';
    case 'past_due': return '#d83152';
    case 'expired': return 'rgba(255,255,255,0.2)';
    default: return 'rgba(125,211,198,0.7)';
  }
};

// --- Header ---
const Header = () => {
  const { t } = useLang();
  return (
    <div style={{ marginBottom: '48px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
        <img
          src="../imgProjet/splash-typoMeteoshoot.png"
          alt="MeteoShoot"
          style={{ height: '28px', opacity: 0.7 }}
        />
        <a href="../index.html" className="back-link">
          <span style={{ fontSize: '16px', position: 'relative', top: '-1px' }}>&larr;</span>
          <span>{t('lang') === 'LANGUE' ? 'Retour' : 'Back'}</span>
        </a>
      </div>
      <h1
        className="font-bebas-light"
        style={{ fontSize: '42px', margin: 0, lineHeight: 1, color: 'rgba(255,255,255,0.85)' }}
      >
        {t('account')}
      </h1>
    </div>
  );
};

// --- Subscription Status ---
const isPaidProfile = (p) => !!p && ['shooter', 'god'].includes(p.subscription_tier) && ['active', 'past_due', 'trialing'].includes(p.subscription_status);
const inTrialProfile = (p) => !!p?.trial_ends_at && !isPaidProfile(p) && new Date(p.trial_ends_at) > new Date();
const effectiveTier = (p) => (isPaidProfile(p) ? p.subscription_tier : inTrialProfile(p) ? 'shooter' : 'free');

const SubscriptionStatus = ({ profile }) => {
  const { t } = useLang();
  const tier = effectiveTier(profile);
  const paid = isPaidProfile(profile);
  const status = paid ? (profile.subscription_status || 'active') : 'active';
  const sub = { fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '14px', color: 'rgba(255,255,255,0.35)', margin: 0, letterSpacing: '0.02em' };

  return (
    <div style={{ marginBottom: '56px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        <span className="status-dot" style={{ backgroundColor: tierDotColor(tier) }} />
        <span className="font-bebas-regular" style={{ fontSize: '32px', lineHeight: 1 }}>
          {tierLabel(tier, t)}
        </span>
        {paid && (
          <span className="status-badge" style={{ borderColor: statusColor(status), color: statusColor(status), marginLeft: '8px' }}>
            {statusLabel(status, t)}
          </span>
        )}
      </div>
      <p style={sub}>{tierTagline(tier, t)}</p>
      {inTrialProfile(profile) && <p style={{ ...sub, color: 'rgba(125,211,198,0.7)', marginTop: '8px' }}>{t('trialUntil').replace('{date}', fmtDate(profile.trial_ends_at, t))}</p>}
      {paid && profile.lemon_variant_name && <p style={{ ...sub, marginTop: '8px' }}>{profile.lemon_variant_name}{profile.current_period_end && status === 'active' ? `, ${t('renewsOn').replace('{date}', fmtDate(profile.current_period_end, t))}` : ''}</p>}
      {paid && status === 'canceled' && profile.subscription_ends_at && <p style={{ ...sub, marginTop: '8px' }}>{t('accessUntil').replace('{date}', fmtDate(profile.subscription_ends_at, t))}</p>}
      {profile?.is_founder && <p style={{ ...sub, color: 'rgba(125,211,198,0.7)', marginTop: '8px' }}>{t('founderLocked')}</p>}
    </div>
  );
};

// --- Pricing Cards ---
const PricingCards = ({ profile, user, freeLimits }) => {
  const { t, lang } = useLang();
  const tier = effectiveTier(profile);
  const isFull = tier === 'shooter' || tier === 'god';
  const founder = !!profile?.is_founder;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const buy = async () => {
    if (busy || !user) return;
    setBusy(true); setNotice('');
    const r = await openLemonCheckout(supabase, lang);
    if (!r.ok) setNotice(r.code === 'not_ready' ? t('comingSoon') : r.code === 'already' ? t('currentPlan') : t('checkoutError'));
    setBusy(false);
  };
  const small = { fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '11px', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.02em' };

  const freeFeatures = [
    t('freeProjectsN').replace('{n}', freeLimits.maxProjects),
    t('forecast10'),
    freeLimits.scene3d ? t('with3d') : t('no3d'),
  ];
  const fullFeatures = [t('unlimitedProjects'), t('forecast10'), t('with3d'), t('continuousUpdates')];

  return (
    <div style={{ marginBottom: '48px' }}>
      <div className="pricing-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
        {/* GRATUIT */}
        <div className={`pricing-card ${!isFull ? 'active-free' : ''}`}>
          <div style={{ marginBottom: '24px' }}>
            <div className="font-bebas-regular" style={{ fontSize: '22px', color: 'rgba(255,255,255,0.7)', marginBottom: '2px' }}>{t('freePlan')}</div>
            <div style={small}>{t('freeTagline')}</div>
          </div>
          <div className="font-bebas-light" style={{ fontSize: '48px', lineHeight: 1, marginBottom: '24px', color: 'rgba(255,255,255,0.6)' }}>
            0<span style={{ fontSize: '24px' }}> $</span>
          </div>
          <ul className="feature-list" style={{ marginBottom: '24px', flex: 1 }}>
            {freeFeatures.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
          {!isFull ? <div className="current-plan-badge">{t('currentPlan')}</div> : <div style={{ height: '40px' }} />}
        </div>

        {/* COMPLET */}
        <div className={`pricing-card ${isFull ? 'active-shooter' : ''}`}>
          <div style={{ marginBottom: '24px' }}>
            <div className="font-bebas-regular" style={{ fontSize: '22px', color: isFull ? '#7dd3c6' : 'rgba(255,255,255,0.7)', marginBottom: '2px' }}>{t('shooterPlan')}</div>
            <div style={small}>{t('shooterTagline')}</div>
          </div>
          <div style={{ marginBottom: founder ? '6px' : '24px' }}>
            <span className="font-bebas-light" style={{ fontSize: '48px', lineHeight: 1, color: isFull ? '#7dd3c6' : 'rgba(255,255,255,0.6)' }}>{t('priceAmount')}</span>
            <span className="font-bebas-light" style={{ fontSize: '18px', color: 'rgba(255,255,255,0.4)', marginLeft: '8px' }}>{t('priceUnit')}</span>
          </div>
          {founder && <div style={{ ...small, color: 'rgba(125,211,198,0.7)', fontSize: '12px', marginBottom: '18px' }}>{t('founderLocked')}</div>}
          <ul className="feature-list" style={{ marginBottom: '24px', flex: 1 }}>
            {fullFeatures.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
          {isPaidProfile(profile) ? (
            <div className="current-plan-badge">{t('currentPlan')}</div>
          ) : (
            <div>
              <button className="upgrade-btn" disabled={busy} onClick={buy}>{busy ? '...' : t('upgradeToShooter')}</button>
              {notice && <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginTop: '10px' }}>{notice}</div>}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .pricing-card { padding: 28px 20px; }
          .pricing-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
};

// --- Manage Subscription ---
const ManageSubscription = ({ profile }) => {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!profile?.lemon_subscription_id) return null;

  const open = async () => {
    setBusy(true); setErr('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(BILLING_PORTAL_FN, { headers: { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY } });
      const data = await res.json();
      if (!res.ok || !data.portal) throw new Error(data.error || 'portail indisponible');
      window.open(data.portal, '_blank', 'noopener');
    } catch (e) {
      setErr(t('portalUnavailable'));
    }
    setBusy(false);
  };

  return (
    <div style={{ marginBottom: '48px' }}>
      <button className="manage-btn" onClick={open} disabled={busy}>{t('manageSub')}</button>
      {err && <p style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '13px', color: 'rgba(255,255,255,0.35)', marginTop: '10px' }}>{err}</p>}
    </div>
  );
};

// --- Language Toggle ---
const LanguageToggle = () => {
  const { lang, setLang } = useLang();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '32px' }}>
      <button
        className={`lang-toggle ${lang === 'fr' ? 'active-lang' : ''}`}
        onClick={() => setLang('fr')}
      >
        FR
      </button>
      <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: '12px' }}>/</span>
      <button
        className={`lang-toggle ${lang === 'en' ? 'active-lang' : ''}`}
        onClick={() => setLang('en')}
      >
        EN
      </button>
    </div>
  );
};

// --- Sign Out ---
const SignOutButton = () => {
  const { t } = useLang();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  };

  return (
    <div style={{ marginBottom: '64px' }}>
      <button className="signout-btn" onClick={handleSignOut}>
        {t('disconnect')}
      </button>
    </div>
  );
};

// --- Loading State ---
const LoadingState = () => (
  <div style={{ maxWidth: '800px', margin: '0 auto', padding: '48px 24px' }}>
    <div style={{ marginBottom: '48px' }}>
      <div className="skeleton" style={{ width: '120px', height: '28px', marginBottom: '32px' }} />
      <div className="skeleton" style={{ width: '200px', height: '42px', marginBottom: '8px' }} />
    </div>
    <div style={{ marginBottom: '56px' }}>
      <div className="skeleton" style={{ width: '160px', height: '32px', marginBottom: '8px' }} />
      <div className="skeleton" style={{ width: '120px', height: '16px' }} />
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
      {[0,1,2].map(i => (
        <div key={i} className="skeleton" style={{ height: '320px' }} />
      ))}
    </div>
  </div>
);

// --- Main App ---
const AccountPage = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [freeLimits, setFreeLimits] = useState({ maxProjects: 3, scene3d: false });

  // Auth check
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        window.location.href = 'login.html';
        return;
      }
      setUser(session.user);

      // Load profile
      const { data } = await supabase
        .from(TBL_PROFILES)
        .select('*')
        .eq('user_id', session.user.id)
        .single();

      setProfile(data || {
        user_id: session.user.id,
        subscription_tier: 'free',
        subscription_status: 'active',
        lemon_customer_id: null,
        lemon_subscription_id: null,
        current_period_end: null,
      });
      setLoading(false);
    };

    init();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        window.location.href = 'login.html';
      } else {
        setUser(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Réglages du gratuit (décidés dans dieu)
  useEffect(() => {
    if (!user) return;
    supabase.from('app_settings').select('value').eq('key', 'free_limits').maybeSingle().then(({ data }) => { if (data?.value) setFreeLimits((f) => ({ ...f, ...data.value })); }, () => {});
  }, [user]);

  // Realtime subscription to profile changes
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('profile-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: TBL_PROFILES,
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.new) {
            setProfile(payload.new);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  if (loading) return <LoadingState />;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '48px 24px', paddingBottom: '80px' }}>
      <Header />
      <SubscriptionStatus profile={profile} />
      <PricingCards profile={profile} user={user} freeLimits={freeLimits} />
      <ManageSubscription profile={profile} />
      <LanguageToggle />
      <SignOutButton />
    </div>
  );
};

// --- Root render ---
const Root = () => (
  <LangProvider>
    <AccountPage />
  </LangProvider>
);

createRoot(document.getElementById('root')).render(<Root />);
