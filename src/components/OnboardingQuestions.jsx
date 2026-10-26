// Première ouverture d'un compte (26 octobre 2026): deux questions, l'une après l'autre. « Tu fais du drone? » puis
// « Tu fais de la vidéo? ». Un non cache les mandats DRONE et DRONE.C, ou VID, dans l'interface; les préférences
// permettent de les réactiver. Posées une seule fois par compte (préférence onboarding_done).
import { useState } from 'react';
import { useLang } from '../i18n/LangProvider.jsx';
import { useStore } from '../projects/StoreProvider.jsx';

export const OnboardingQuestions = () => {
  const { setPrefs } = useStore();
  const { t } = useLang();
  const [step, setStep] = useState(0); // 0: drone, 1: vidéo
  const [drone, setDrone] = useState(null);
  const [leaving, setLeaving] = useState(false);

  const answer = (yes) => {
    if (leaving) return;
    if (step === 0) {
      setDrone(yes);
      setLeaving(true);
      setTimeout(() => { setStep(1); setLeaving(false); }, 220);
    } else {
      setLeaving(true);
      setTimeout(() => setPrefs({ doesDrone: drone !== false, doesVideo: yes, onboardingDone: true }), 220);
    }
  };

  const question = step === 0 ? t('onboardDrone') : t('onboardVideo');
  const btn = (yes) => (
    <button onClick={() => answer(yes)} className="font-bebas-book" style={{
      background: 'none', border: '1px solid rgba(255,255,255,0.25)', color: '#ffffff', cursor: 'pointer',
      fontSize: '26px', letterSpacing: '0.08em', padding: '14px 44px', minWidth: '150px', lineHeight: 1,
      transition: 'border-color 0.2s, background 0.2s'
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(125,211,198,0.8)'; e.currentTarget.style.background = 'rgba(125,211,198,0.08)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'; e.currentTarget.style.background = 'none'; }}
    >{(yes ? t('yes') : t('no')).toUpperCase()}</button>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 150, background: '#181b1e', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: '900px', height: '900px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(170,215,208,0.22) 0%, rgba(150,200,195,0.05) 35%, transparent 60%)', filter: 'blur(60px)', pointerEvents: 'none' }} />
      <div key={step} style={{ position: 'relative', textAlign: 'center', opacity: leaving ? 0 : 1, transform: leaving ? 'translateY(-6px)' : 'none', transition: 'opacity 0.22s ease, transform 0.22s ease', animation: 'fadeIn 0.4s ease' }}>
        <div className="font-bebas-light" style={{ fontSize: '14px', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: '22px' }}>{step + 1} / 2</div>
        <div className="font-bebas-book" style={{ fontSize: 'clamp(34px, 6vw, 56px)', letterSpacing: '0.05em', color: '#ffffff', lineHeight: 1.05, marginBottom: '40px' }}>{question.toUpperCase()}</div>
        <div style={{ display: 'flex', gap: '18px', justifyContent: 'center', flexWrap: 'wrap' }}>{btn(true)}{btn(false)}</div>
        <div style={{ fontFamily: "'Avenir', 'Montserrat', sans-serif", fontWeight: 300, fontSize: '14px', color: 'rgba(255,255,255,0.35)', marginTop: '34px', letterSpacing: '0.02em' }}>{t('onboardNote')}</div>
      </div>
    </div>
  );
};
