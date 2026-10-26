// Compte à rebours de la période gratuite (phase 3, 25 octobre 2026). Pastille discrète en bas de l'écran:
// à 30, 7 et 1 jours de la fin (chaque palier se ferme d'un geste et revient au palier suivant), puis « période
// gratuite terminée » tant que l'abonnement n'est pas pris. Un toucher ouvre le modal des forfaits.
import { useEffect, useState } from 'react';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useLang } from '../i18n/LangProvider.jsx';
import { useSubscription } from './SubscriptionProvider.jsx';

const KEY = 'ms-trial-dismissed';
const bucketOf = (days) => (days <= 1 ? 1 : days <= 7 ? 7 : 30);

export const TrialBanner = () => {
  const { inTrial, trialEnded, trialDaysLeft, openUpgrade, subLoading, profile } = useSubscription();
  const { t } = useLang();
  const isMobile = useIsMobile();
  const [dismissed, setDismissed] = useState(() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } });
  const [hiddenNow, setHiddenNow] = useState(false);

  useEffect(() => { setHiddenNow(false); }, [inTrial, trialEnded, trialDaysLeft]);

  if (subLoading || !profile || hiddenNow) return null;
  const ended = trialEnded;
  const countdown = inTrial && trialDaysLeft <= 30;
  if (!ended && !countdown) return null;
  const bucket = countdown ? bucketOf(trialDaysLeft) : 0;
  if (countdown && dismissed && dismissed.bucket === bucket) return null;

  const text = ended
    ? t('trialEndedTitle')
    : trialDaysLeft <= 1 ? t('trialLastDay') : t('trialDaysLeftN').replace('{n}', trialDaysLeft);
  const close = (e) => {
    e.stopPropagation();
    if (ended) { setHiddenNow(true); return; }
    const d = { bucket, at: new Date().toISOString() };
    setDismissed(d);
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* stockage indisponible */ }
  };

  return (
    <div onClick={openUpgrade} style={{
      position: 'fixed', left: '50%', transform: 'translateX(-50%)',
      bottom: isMobile ? 'calc(96px + env(safe-area-inset-bottom))' : '28px',
      zIndex: 60, display: 'flex', alignItems: 'center', gap: '14px',
      padding: '10px 14px 10px 18px', borderRadius: '999px', cursor: 'pointer',
      background: ended ? 'rgba(224,122,43,0.14)' : 'rgba(24,27,30,0.82)',
      border: `1px solid ${ended ? 'rgba(224,122,43,0.45)' : 'rgba(255,255,255,0.14)'}`,
      backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      boxShadow: '0 8px 30px rgba(0,0,0,0.35)', whiteSpace: 'nowrap', maxWidth: 'calc(100vw - 32px)'
    }}>
      <span className="font-bebas-regular" style={{ fontSize: '16px', letterSpacing: '0.06em', color: ended ? '#E07A2B' : 'rgba(255,255,255,0.85)', lineHeight: 1 }}>
        {text.toUpperCase()}
      </span>
      <span className="font-bebas-light" style={{ fontSize: '14px', letterSpacing: '0.06em', color: ended ? 'rgba(224,122,43,0.8)' : 'rgba(125,211,198,0.9)', lineHeight: 1 }}>
        {t('seeFull').toUpperCase()}
      </span>
      <button onClick={close} aria-label="Fermer" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', color: 'rgba(255,255,255,0.4)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'relative', top: '0px' }}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
  );
};
