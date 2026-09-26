import './account.css';
import '@fontsource/montserrat/300.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY, LEMON_CHECKOUT_URL } from '../shared/config.js';
import { TRANSLATIONS, getDefaultLang } from '../shared/translations.js';


// --- Supabase init ---
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const TBL_PROFILES = isDev ? 'user_profiles_dev' : 'user_profiles';

// --- LemonSqueezy customer portal base ---
const LEMON_PORTAL_URL = 'https://meteoshoot.lemonsqueezy.com/billing';

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
    case 'shooter': return '#E07A2B';
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
    case 'past_due': return '#E07A2B';
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
const SubscriptionStatus = ({ profile }) => {
  const { t } = useLang();
  const tier = profile?.subscription_tier || 'free';
  const status = profile?.subscription_status || (tier === 'free' ? 'active' : 'active');

  return (
    <div style={{ marginBottom: '56px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        <span className="status-dot" style={{ backgroundColor: tierDotColor(tier) }} />
        <span className="font-bebas-regular" style={{ fontSize: '32px', lineHeight: 1 }}>
          {tierLabel(tier, t)}
        </span>
        {tier !== 'free' && (
          <span
            className="status-badge"
            style={{ borderColor: statusColor(status), color: statusColor(status), marginLeft: '8px' }}
          >
            {statusLabel(status, t)}
          </span>
        )}
      </div>
      <p style={{
        fontFamily: "'Montserrat', sans-serif",
        fontWeight: 300,
        fontSize: '14px',
        color: 'rgba(255,255,255,0.35)',
        margin: 0,
        letterSpacing: '0.02em'
      }}>
        {tierTagline(tier, t)}
      </p>
    </div>
  );
};

// --- Pricing Cards ---
const PricingCards = ({ profile, user }) => {
  const { t } = useLang();
  const currentTier = profile?.subscription_tier || 'free';

  const handleUpgradeShooter = () => {
    if (!user) return;
    window.createLemonSqueezy && window.createLemonSqueezy();
    window.LemonSqueezy.Url.Open(
      LEMON_CHECKOUT_URL +
      '?checkout[custom][user_id]=' + user.id +
      '&checkout[email]=' + encodeURIComponent(user.email) +
      '&embed=1'
    );
  };

  const freeFeatures = [
    t('maxProjectsFree'),
    t('basicWeather'),
    t('storagePerProject'),
  ];

  const shooterFeatures = [
    t('unlimitedProjects'),
    t('allFeatures'),
    t('continuousUpdates'),
  ];

  const godFeatures = [
    t('shooterPlus'),
    t('premiumWeather'),
    t('advancedFeatures'),
  ];

  return (
    <div style={{ marginBottom: '48px' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '16px',
      }}>
        {/* FREE card */}
        <div className={`pricing-card ${currentTier === 'free' ? 'active-free' : ''}`}>
          <div style={{ marginBottom: '24px' }}>
            <div className="font-bebas-regular" style={{ fontSize: '22px', color: 'rgba(255,255,255,0.7)', marginBottom: '2px' }}>
              {t('freePlan')}
            </div>
            <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '11px', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.02em' }}>
              {t('freeTagline')}
            </div>
          </div>
          <div className="font-bebas-light" style={{ fontSize: '48px', lineHeight: 1, marginBottom: '24px', color: 'rgba(255,255,255,0.6)' }}>
            0<span style={{ fontSize: '24px' }}>$</span>
          </div>
          <ul className="feature-list" style={{ marginBottom: '24px', flex: 1 }}>
            {freeFeatures.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
          {currentTier === 'free' ? (
            <div className="current-plan-badge">{t('currentPlan')}</div>
          ) : (
            <div style={{ height: '40px' }} />
          )}
        </div>

        {/* SHOOTER card */}
        <div className={`pricing-card ${currentTier === 'shooter' ? 'active-shooter' : ''}`}>
          <div style={{ marginBottom: '24px' }}>
            <div className="font-bebas-regular" style={{ fontSize: '22px', color: currentTier === 'shooter' ? '#E07A2B' : 'rgba(255,255,255,0.7)', marginBottom: '2px' }}>
              {t('shooterPlan')}
            </div>
            <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '11px', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.02em' }}>
              {t('shooterTagline')}
            </div>
          </div>
          <div className="font-bebas-light" style={{ fontSize: '48px', lineHeight: 1, marginBottom: '24px', color: currentTier === 'shooter' ? '#E07A2B' : 'rgba(255,255,255,0.6)' }}>
            ---
          </div>
          <ul className="feature-list" style={{ marginBottom: '24px', flex: 1 }}>
            {shooterFeatures.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
          {currentTier === 'shooter' ? (
            <div className="current-plan-badge">{t('currentPlan')}</div>
          ) : (
            <button className="upgrade-btn" onClick={handleUpgradeShooter}>
              {t('upgradeToShooter')}
            </button>
          )}
        </div>

        {/* GOD card */}
        <div className="pricing-card dimmed">
          <div style={{ marginBottom: '24px' }}>
            <div className="font-bebas-regular" style={{ fontSize: '22px', color: 'rgba(255,255,255,0.7)', marginBottom: '2px' }}>
              {t('godPlan')}
            </div>
            <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 300, fontSize: '11px', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.02em' }}>
              {t('godTagline')}
            </div>
          </div>
          <div className="font-bebas-light" style={{ fontSize: '48px', lineHeight: 1, marginBottom: '24px', color: 'rgba(255,255,255,0.6)' }}>
            ---
          </div>
          <ul className="feature-list" style={{ marginBottom: '24px', flex: 1 }}>
            {godFeatures.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
          <div className="coming-soon-badge">{t('comingSoon')}</div>
        </div>
      </div>

      {/* Responsive override for mobile */}
      <style>{`
        @media (max-width: 768px) {
          .pricing-card {
            padding: 28px 20px;
          }
          div[style*="gridTemplateColumns"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
};

// --- Manage Subscription ---
const ManageSubscription = ({ profile }) => {
  const { t } = useLang();

  if (!profile?.lemon_subscription_id) return null;

  return (
    <div style={{ marginBottom: '48px' }}>
      <a
        href={LEMON_PORTAL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="manage-btn"
      >
        {t('manageSub')}
      </a>
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
      <PricingCards profile={profile} user={user} />
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
