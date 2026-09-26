import { useEffect, useState } from 'react';
import { useLang } from '../i18n/LangProvider.jsx';

export const UndoToast = ({ onUndo, projectName }) => {
  const { t } = useLang();
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div style={{
      position: 'fixed', bottom: '30px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(20,24,27,0.92)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      borderRadius: '14px', padding: '12px 24px', zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: '16px',
      border: '1px solid rgba(255,255,255,0.1)',
      animation: 'fadeIn 0.3s ease'
    }}>
      <span className="font-bebas-bold" style={{ letterSpacing: '0.04em', fontSize: '16px', color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap' }}>{t('projectDeleted')}</span>
      <button onClick={onUndo} className="font-bebas-bold" style={{ letterSpacing: '0.04em', background: 'none', border: 'none', color: '#FAF9F7', fontSize: '16px', cursor: 'pointer', textShadow: '0 0 12px rgba(255,255,255,0.4)', padding: '0' }}>{t('undo')}</button>
      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>{/iPhone|iPad|Android/i.test(navigator.userAgent) ? '' : '⌘Z'}</span>
    </div>
  );
};
