import { useAuth } from '../auth/AuthProvider.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useLang } from '../i18n/LangProvider.jsx';
import { isNative } from '../native/platform.js';
import { lemonCheckoutUrl, openLemonCheckout } from '../shared/config.js';
import { useSubscription } from './SubscriptionProvider.jsx';

// ===== MODAL DES FORFAITS =====
// Deux colonnes (phase 3, 25 octobre 2026): GRATUIT (limites lues dans les réglages de dieu) et COMPLET. Le prix et le
// bouton de paiement n'apparaissent que sur le web: dans l'app iPhone et iPad, pas de prix ni de lien d'achat (règles
// d'Apple; l'achat intégré viendra avec la mise en App Store).
const fmtDate = (d, t) => d ? `${d.getDate()} ${t('monthAbbrev')[d.getMonth()]} ${d.getFullYear()}` : '';

export const UpgradeModal = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { tier, freeLimits, inTrial, trialEndsAt, isFounder, isPaid } = useSubscription();
  const { t } = useLang();
  const isMobile = useIsMobile();

  const checkoutReady = !!lemonCheckoutUrl(user, isFounder);
  const openCheckout = () => { openLemonCheckout(user, isFounder); };

  if (!isOpen) return null;

  const isFull = tier === 'shooter' || tier === 'god';
  const cardStyle = { flex: 1, border: '1px solid rgba(255,255,255,0.12)', padding: '28px 24px', position: 'relative' };
  const titleStyle = { fontFamily: "'Bebas Neue', sans-serif", fontWeight: 700, letterSpacing: '0.04em' };
  const taglineStyle = { fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, fontSize: '14px', color: 'rgba(255,255,255,0.35)', fontStyle: 'italic', marginTop: '4px', letterSpacing: '0.02em' };
  const featureStyle = { color: 'rgba(255,255,255,0.5)', fontSize: '14px', marginBottom: '8px', fontFamily: "'Montserrat', sans-serif", fontWeight: 300 };
  const featureFull = { ...featureStyle, color: 'rgba(255,255,255,0.75)' };
  const current = <div style={{ ...titleStyle, fontSize: '15px', color: '#7dd3c6' }}>{t('currentPlan')}</div>;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: '720px', width: '100%' }}>
        <h2 style={{ ...titleStyle, fontSize: '32px', color: '#ffffff', textAlign: 'center', marginBottom: '36px' }}>{t('choosePlan')}</h2>

        <div style={{ display: 'flex', gap: '16px', flexDirection: isMobile ? 'column' : 'row' }}>
          {/* GRATUIT */}
          <div style={{ ...cardStyle, borderColor: !isFull ? '#7dd3c6' : 'rgba(255,255,255,0.12)' }}>
            <div style={{ ...titleStyle, fontSize: '22px', color: '#8B9B99' }}>{t('freePlan')}</div>
            <div style={taglineStyle}>{t('freeTagline')}</div>
            <div style={{ ...titleStyle, fontSize: '44px', color: '#ffffff', margin: '16px 0 4px' }}>0 $</div>
            <div style={{ margin: '16px 0 20px' }}>
              <div style={featureStyle}>{t('freeProjectsN').replace('{n}', freeLimits.maxProjects)}</div>
              <div style={featureStyle}>{t('forecastDaysN').replace('{n}', freeLimits.forecastDays)}</div>
              <div style={featureStyle}>{freeLimits.scene3d ? t('with3d') : t('no3d')}</div>
            </div>
            {!isFull && current}
          </div>

          {/* COMPLET */}
          <div style={{ ...cardStyle, borderColor: '#E07A2B', boxShadow: '0 0 30px rgba(224,122,43,0.1)' }}>
            <div style={{ ...titleStyle, fontSize: '22px', color: '#E07A2B' }}>{t('shooterPlan')}</div>
            <div style={taglineStyle}>{t('shooterTagline')}</div>
            {!isNative && (
              <div style={{ margin: '16px 0 4px' }}>
                <span style={{ ...titleStyle, fontSize: '44px', color: '#ffffff' }}>{t('priceAmount')}</span>
                <span style={{ ...titleStyle, fontSize: '18px', color: 'rgba(255,255,255,0.45)', marginLeft: '8px' }}>{t('priceUnit')}</span>
              </div>
            )}
            {!isNative && isFounder && (
              <div style={{ ...featureStyle, color: '#7dd3c6', marginTop: '2px' }}>{t('founderLocked')}</div>
            )}
            <div style={{ margin: '16px 0 20px' }}>
              <div style={featureFull}>{t('unlimitedProjects')}</div>
              <div style={featureFull}>{t('forecast10')}</div>
              <div style={featureFull}>{t('with3d')}</div>
              <div style={featureFull}>{t('continuousUpdates')}</div>
            </div>
            {isFull ? (
              <div>
                <div style={{ ...titleStyle, fontSize: '15px', color: '#E07A2B' }}>{t('currentPlan')}</div>
                {inTrial && !isPaid && <div style={{ ...featureStyle, marginTop: '6px', marginBottom: 0 }}>{t('trialUntil').replace('{date}', fmtDate(trialEndsAt, t))}</div>}
              </div>
            ) : isNative ? (
              <div style={{ ...featureStyle, marginBottom: 0 }}>{t('manageOnWeb')}</div>
            ) : (
              <button onClick={openCheckout} disabled={!checkoutReady} title={checkoutReady ? '' : t('comingSoon')} style={{
                background: '#E07A2B', color: '#ffffff', border: 'none', opacity: checkoutReady ? 1 : 0.45,
                padding: '12px 24px', cursor: checkoutReady ? 'pointer' : 'default', width: '100%',
                fontFamily: "'Bebas Neue', sans-serif", fontWeight: 700, fontSize: '16px',
                letterSpacing: '0.04em'
              }}>{t('upgradeToShooter')}</button>
            )}
          </div>
        </div>

        {!isNative && (
          <div style={{ textAlign: 'center', marginTop: '24px' }}>
            <a href="site/account.html" style={{ color: 'rgba(255,255,255,0.3)', fontSize: '13px', fontFamily: "'Montserrat', sans-serif", textDecoration: 'none' }}>{t('account')}</a>
          </div>
        )}
      </div>
    </div>
  );
};

// Instance unique pilotée par le fournisseur d'abonnement (ouverte depuis la rangée météo, la vue 3D, la pastille).
export const GlobalUpgradeModal = () => {
  const { upgradeOpen, closeUpgrade } = useSubscription();
  return <UpgradeModal isOpen={upgradeOpen} onClose={closeUpgrade} />;
};
