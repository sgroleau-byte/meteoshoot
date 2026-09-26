import { useEffect, useState } from 'react';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useLang } from '../i18n/LangProvider.jsx';
import { ProjectStatus } from '../projects/constants.js';
import { getEditListPrefs } from '../projects/helpers.js';
import { useStore } from '../projects/StoreProvider.jsx';
import { daysSince } from '../utils/dates.js';
import { DoneCard, EDIT_FONT, RetouchingCard } from './EditList.jsx';

export const RetouchingView = ({ onSelect }) => {
  const { projects, prefs } = useStore();
  const { t } = useLang();
  const isMobile = useIsMobile();
  const [openActionsId, setOpenActionsId] = useState(null);
  const editPrefs = getEditListPrefs(prefs);
  // Jours en retouche recalculés à minuit (app laissée ouverte) et au retour au premier plan.
  const [, setDayTick] = useState(0);
  useEffect(() => {
    let timer = null;
    const schedule = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
      timer = setTimeout(() => { setDayTick(x => x + 1); schedule(); }, next - now);
    };
    schedule();
    const onVisible = () => { if (document.visibilityState === 'visible') setDayTick(x => x + 1); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  // Jours entiers depuis la date d'édition; tri décroissant (le plus ancien en haut) si demandé.
  const retouching = projects.filter(p => p.status === ProjectStatus.RETOUCHING).map(p => { const d = p.shotAt ? daysSince(p.shotAt) : null; return { project: p, days: Number.isFinite(d) ? d : null }; });
  if (editPrefs.editSortUrgency) retouching.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
  const done = projects.filter(p => p.status === ProjectStatus.DONE);
  const legend = t('editLegend').replace(/\{alert\}/g, editPrefs.editAlertDays).replace(/\{warn\}/g, editPrefs.editWarnDays);
  return (
    <div className="pb-8" style={{ paddingLeft: isMobile ? '0' : 'max(0px, calc((100vw - 1200px) / 2))', paddingTop: isMobile ? 'calc(16px + env(safe-area-inset-top))' : '100px', ...(isMobile ? { minHeight: '100vh', touchAction: 'pan-y', overflowX: 'clip' } : {}) }}>
      {!isMobile && <h1 className="font-bebas-bold" style={{ position: 'fixed', top: '7px', left: '10px', fontSize: '24px', color: '#5a6b69', letterSpacing: '0.03em', zIndex: 5 }}>{t('editing')}</h1>}
      {retouching.length === 0 ? <div className="text-center py-16"><p className="font-bebas-book text-charcoal-muted" style={{ letterSpacing: '0.04em', fontSize: '24px' }}>{t('noProjectsEditing')}</p></div>
      : <div style={{ paddingBottom: '80px' }}>
          {retouching.map(({ project, days }, i) => <RetouchingCard key={project.id} project={project} days={days} editPrefs={editPrefs} onSelect={onSelect} index={i} openActionsId={openActionsId} setOpenActionsId={setOpenActionsId}/>)}
          {/* Légende des seuils, sous la liste */}
          <div style={{ padding: isMobile ? '0 20px 14px' : '10px 34px 14px', color: '#4d5a54', fontSize: '10px', letterSpacing: '0.16em', textTransform: 'uppercase', fontFamily: EDIT_FONT }}>{legend}</div>
        </div>}
      {done.length > 0 && <>
        <div className={isMobile ? 'px-6' : 'px-4'} style={{ paddingTop: '16px', paddingBottom: '16px', marginTop: '32px', }}><h2 className="font-bebas-light" style={{ letterSpacing: '0.04em', fontSize: '28px', color: '#8B9B99' }}>{t('archived')}</h2></div>
        <div style={{ paddingBottom: '80px' }}>{done.map(p => <DoneCard key={p.id} project={p} editPrefs={editPrefs}/>)}</div>
      </>}
    </div>
  );
};
