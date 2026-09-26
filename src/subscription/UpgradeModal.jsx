import { useAuth } from '../auth/AuthProvider.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useLang } from '../i18n/LangProvider.jsx';
import { LEMON_CHECKOUT_URL } from '../shared/config.js';
import { useSubscription } from './SubscriptionProvider.jsx';

// ===== UPGRADE MODAL =====
export const UpgradeModal = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { tier } = useSubscription();
  const { t } = useLang();
  const isMobile = useIsMobile();

  const openCheckout = () => {
    if (typeof window.createLemonSqueezy === 'function') window.createLemonSqueezy();
    if (window.LemonSqueezy && window.LemonSqueezy.Url) {
      window.LemonSqueezy.Url.Open(
        LEMON_CHECKOUT_URL + '?checkout[custom][user_id]=' + user.id + '&checkout[email]=' + encodeURIComponent(user.email) + '&embed=1'
      );
    } else {
      window.open(LEMON_CHECKOUT_URL + '?checkout[custom][user_id]=' + user.id + '&checkout[email]=' + encodeURIComponent(user.email), '_blank');
    }
  };

  if (!isOpen) return null;

  const cardStyle = { flex: 1, border: '1px solid rgba(255,255,255,0.12)', padding: '28px 24px', position: 'relative' };
  const titleStyle = { fontFamily: "'Bebas Neue', sans-serif", fontWeight: 700, letterSpacing: '0.04em' };
  const taglineStyle = { fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, fontSize: '14px', color: 'rgba(255,255,255,0.35)', fontStyle: 'italic', marginTop: '4px', letterSpacing: '0.02em' };
  const featureStyle = { color: 'rgba(255,255,255,0.5)', fontSize: '14px', marginBottom: '8px', fontFamily: "'Montserrat', sans-serif", fontWeight: 300 };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: '860px', width: '100%' }}>
        <h2 style={{ ...titleStyle, fontSize: '32px', color: '#ffffff', textAlign: 'center', marginBottom: '36px' }}>{t('choosePlan')}</h2>

        <div style={{ display: 'flex', gap: '16px', flexDirection: isMobile ? 'column' : 'row' }}>
          {/* GRATUIT */}
          <div style={{ ...cardStyle, borderColor: tier === 'free' ? '#7dd3c6' : 'rgba(255,255,255,0.12)' }}>
            <div style={{ ...titleStyle, fontSize: '22px', color: '#8B9B99' }}>{t('freePlan')}</div>
            <div style={taglineStyle}>{t('freeTagline')}</div>
            <div style={{ ...titleStyle, fontSize: '44px', color: '#ffffff', margin: '16px 0 4px' }}>0$</div>
            <div style={{ margin: '16px 0 20px' }}>
              <div style={featureStyle}>{t('maxProjectsFree')}</div>
              <div style={featureStyle}>{t('basicWeather')}</div>
              <div style={featureStyle}>{t('storagePerProject')}</div>
            </div>
            {tier === 'free' && <div style={{ ...titleStyle, fontSize: '15px', color: '#7dd3c6' }}>{t('currentPlan')}</div>}
          </div>

          {/* SHOOTER */}
          <div style={{ ...cardStyle, borderColor: tier === 'shooter' ? '#E07A2B' : '#E07A2B', boxShadow: '0 0 30px rgba(224,122,43,0.1)' }}>
            <div style={{ ...titleStyle, fontSize: '22px', color: '#E07A2B' }}>{t('shooterPlan')}</div>
            <div style={taglineStyle}>{t('shooterTagline')}</div>
            <div style={{ ...titleStyle, fontSize: '44px', color: '#ffffff', margin: '16px 0 4px' }}>---</div>
            <div style={{ margin: '16px 0 20px' }}>
              <div style={{ ...featureStyle, color: 'rgba(255,255,255,0.7)' }}>{t('unlimitedProjects')}</div>
              <div style={{ ...featureStyle, color: 'rgba(255,255,255,0.7)' }}>{t('allFeatures')}</div>
              <div style={{ ...featureStyle, color: 'rgba(255,255,255,0.7)' }}>{t('continuousUpdates')}</div>
            </div>
            {tier === 'shooter' ? (
              <div style={{ ...titleStyle, fontSize: '15px', color: '#E07A2B' }}>{t('currentPlan')}</div>
            ) : (
              <button onClick={openCheckout} style={{
                background: '#E07A2B', color: '#ffffff', border: 'none',
                padding: '12px 24px', cursor: 'pointer', width: '100%',
                fontFamily: "'Bebas Neue', sans-serif", fontWeight: 700, fontSize: '16px',
                letterSpacing: '0.04em'
              }}>{t('upgradeToShooter')}</button>
            )}
          </div>

          {/* GOD */}
          <div style={{ ...cardStyle, opacity: 0.35, borderColor: 'rgba(255,255,255,0.06)' }}>
            <div style={{ ...titleStyle, fontSize: '22px', color: '#8B9B99' }}>{t('godPlan')}</div>
            <div style={taglineStyle}>{t('godTagline')}</div>
            <div style={{ ...titleStyle, fontSize: '44px', color: '#ffffff', margin: '16px 0 4px' }}>---</div>
            <div style={{ margin: '16px 0 20px' }}>
              <div style={featureStyle}>{t('shooterPlus')}</div>
              <div style={featureStyle}>{t('premiumWeather')}</div>
              <div style={featureStyle}>{t('advancedFeatures')}</div>
            </div>
            <div style={{ ...titleStyle, fontSize: '15px', color: 'rgba(255,255,255,0.3)' }}>{t('comingSoon')}</div>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: '24px' }}>
          <a href="site/account.html" style={{ color: 'rgba(255,255,255,0.3)', fontSize: '13px', fontFamily: "'Montserrat', sans-serif", textDecoration: 'none' }}>{t('account')}</a>
        </div>
      </div>
    </div>
  );
};
