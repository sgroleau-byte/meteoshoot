import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useSwipeActions } from '../hooks/useSwipeActions.js';
import { useLang } from '../i18n/LangProvider.jsx';
import { EDIT_GAUGE_MAX_DAYS, EDIT_LIST_DEFAULTS, editDaysFrozen, editStatusFor } from '../projects/helpers.js';
import { useStore } from '../projects/StoreProvider.jsx';
import { formatDateShort } from '../utils/dates.js';
import { afterEntrance } from '../utils/entrance.js';
import { StarIcon, TrashIcon } from './icons/misc.jsx';
import { DateWheelPicker } from './pickers.jsx';

// ===== LISTE ÉDITION (option 2a) : gros chiffre des jours en retouche à gauche, jauge sous le nom =====
// La coque des cartes (fond, halos, filets, actions au survol / glissement) est inchangée;
// seul le contenu de la rangée suit la maquette 2a (typo Oswald, 46 / 17 / 11 / 10 px).
export const EDIT_FONT = "'Oswald', system-ui, sans-serif";
export const EDIT_STATUS_COLORS = {
  alert:  { num: '#e0483e', suffix: '#e0483e', gauge: '#e0483e' },
  warn:   { num: '#d9a441', suffix: '#d9a441', gauge: '#d9a441' },
  normal: { num: '#e8ece9', suffix: '#6b7a72', gauge: '#5d6f66' }
};
// Teinte graduée entre le seuil d'attention et le seuil d'alerte : ambre exact au premier, rouge exact
// au second, et entre les deux chaque jour tire un peu plus vers le rouge (orangés). Hors de cette
// plage (neutre, rouge, archives), la palette fixe s'applique.
export const editLerpHex = (a, b, k) => { const ch = (h, i) => parseInt(h.slice(i, i + 2), 16); return '#' + [1, 3, 5].map(i => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * k).toString(16).padStart(2, '0')).join(''); };
export const editToneFor = (days, status, ep) => {
  if (status !== 'warn' || days === null || !(ep.editAlertDays > ep.editWarnDays)) return EDIT_STATUS_COLORS[status];
  const k = Math.min(1, Math.max(0, (days - ep.editWarnDays) / (ep.editAlertDays - ep.editWarnDays)));
  const c = editLerpHex(EDIT_STATUS_COLORS.warn.num, EDIT_STATUS_COLORS.alert.num, k);
  return { num: c, suffix: c, gauge: c };
};
// Tags du projet dans l'ordre fixe INT · EXT · DRONE · DRONE.C · VID
export const editTagsLabel = (mandates) => ['INT', 'EXT', 'DRONE', 'DRONE+C', 'VID'].filter(m => mandates?.includes(m)).map(m => m === 'DRONE+C' ? 'DRONE.C' : m).join(' · ');

// Chiffre des jours + suffixe (J / D). Poids 600 si alerte ou attention, 300 sinon.
export const EditDaysFigure = ({ days, status, compact, tone }) => {
  const { t } = useLang();
  const c = tone || EDIT_STATUS_COLORS[status];
  return (
    <div style={{ width: compact ? '62px' : '86px', display: 'flex', alignItems: 'baseline', gap: '5px', flexShrink: 0 }}>
      <span style={{ fontSize: compact ? '38px' : '46px', fontWeight: status === 'normal' ? 300 : 600, lineHeight: 1, color: c.num }}>{days === null ? '' : days}</span>
      {days !== null && <span style={{ fontSize: '10px', letterSpacing: '0.15em', color: c.suffix }}>{t('daysShort')}</span>}
    </div>
  );
};

// Jauge : remplissage = jours / échelle (60 j, plafonné), repère vertical au seuil d'alerte. À l'apparition, le
// remplissage grandit de gauche à droite (classe edit-gauge-fill, app.css), un projet après l'autre selon index.
export const EditGauge = ({ days, status, editPrefs, tone, index = 0 }) => {
  const pct = days === null ? 0 : Math.min(100, (days / EDIT_GAUGE_MAX_DAYS) * 100);
  const thr = Math.min(100, (editPrefs.editAlertDays / EDIT_GAUGE_MAX_DAYS) * 100);
  return (
    <div style={{ position: 'relative', height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', marginTop: '9px' }}>
      {pct > 0 && <div className="edit-gauge-fill" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: (tone || EDIT_STATUS_COLORS[status]).gauge, borderRadius: '2px', animationDelay: `${0.25 + index * 0.12}s` }}/>}
      {editPrefs.editShowThreshold && <div style={{ position: 'absolute', top: '-3px', bottom: '-3px', left: `${thr}%`, width: '1px', background: 'rgba(232,236,233,0.35)' }}/>}
    </div>
  );
};

// Rangée 2a, contenu seul (sans la coque de carte) : partagée par les projets en retouche et les archives.
// compact = mobile (chiffre, puis nom, ligne tags + date, jauge); sinon chiffre | nom + tags + jauge | date.
export const EditRow = ({ project, days, status, editPrefs, dateLabel, compact, onClick, onDateClick, dateActive, index = 0 }) => {
  const tags = editTagsLabel(project.mandates);
  const tone = editToneFor(days, status, editPrefs);
  const name = <span style={{ color: '#e8ece9', fontSize: compact ? '15px' : '17px', letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1.2, minWidth: 0 }}>{project.name} {project.isContest && <StarIcon/>}</span>;
  const gauge = editPrefs.editShowGauge && <EditGauge days={days} status={status} editPrefs={editPrefs} tone={tone} index={index}/>;
  if (compact) {
    return (
      <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 8px 12px 4px', fontFamily: EDIT_FONT }}>
        <EditDaysFigure days={days} status={status} tone={tone} compact/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '16px' }}>{name}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', marginTop: '4px' }}>
            <span style={{ color: '#4d5a54', fontSize: '10px', letterSpacing: '0.14em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tags}</span>
            <span style={{ color: '#6b7a72', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0 }}>{dateLabel}</span>
          </div>
          {gauge}
        </div>
      </div>
    );
  }
  return (
    <div onClick={onClick} className={onClick ? 'cursor-pointer' : undefined} style={{ display: 'flex', alignItems: 'center', gap: '26px', padding: '4px 18px', maxWidth: '720px', boxSizing: 'border-box', fontFamily: EDIT_FONT }}>
      <EditDaysFigure days={days} status={status} tone={tone}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '16px' }}>
          {name}
          <span style={{ color: '#4d5a54', fontSize: '10px', letterSpacing: '0.14em', whiteSpace: 'nowrap', flexShrink: 0 }}>{tags}</span>
        </div>
        {gauge}
      </div>
      <div onClick={onDateClick} style={{ width: '82px', textAlign: 'right', color: '#6b7a72', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0, textDecoration: dateActive ? 'underline' : 'none', textDecorationColor: 'rgba(255,255,255,0.3)', textUnderlineOffset: '3px' }}>{dateLabel}</div>
    </div>
  );
};

export const RetouchingCard = ({ project, onSelect, index = 0, openActionsId, setOpenActionsId, days = null, editPrefs = EDIT_LIST_DEFAULTS }) => {
  const { advanceProject, revertProject, deleteProject, updateProject } = useStore();
  const { t } = useLang();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReady, setConfirmReady] = useState(false);
  const [confirmDone, setConfirmDone] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [editingShotDate, setEditingShotDate] = useState(false);
  const [pickerPos, setPickerPos] = useState({ top: 0, left: 0 });
  const originalDateRef = useRef(null);
  const status = editStatusFor(days, editPrefs);
  const dateLabel = project.shotAt ? formatDateShort(project.shotAt) : '- - -';

  const colorCharcoal = '#8B9B99';

  const handleDelete = (e) => {
    e.stopPropagation(); e.preventDefault();
    if (confirmDelete && confirmReady) { deleteProject(project.id); } else if (!confirmDelete) { setConfirmDelete(true); setConfirmReady(false); setConfirmDone(false); setConfirmRevert(false); setTimeout(() => setConfirmReady(true), 600); setTimeout(() => { setConfirmDelete(false); setConfirmReady(false); }, 4000); }
  };
  const handleDone = (e) => {
    e.stopPropagation(); e.preventDefault();
    if (confirmDone) { advanceProject(project.id); setConfirmDone(false); } else { setConfirmDone(true); setConfirmDelete(false); setConfirmRevert(false); setTimeout(() => setConfirmDone(false), 3000); }
  };
  const handleRevert = (e) => {
    e.stopPropagation(); e.preventDefault();
    if (confirmRevert) { revertProject(project.id); setConfirmRevert(false); } else { setConfirmRevert(true); setConfirmDelete(false); setConfirmDone(false); setTimeout(() => setConfirmRevert(false), 3000); }
  };

  const isMobile = useIsMobile();

  const cardRef = useRef(null);
  const contentRef = useRef(null);
  const actionsRef = useRef(null);
  const haloWhiteRef = useRef(null);
  const actionsOpen = openActionsId === project.id;
  const setActionsOpen = (v) => setOpenActionsId ? setOpenActionsId(v ? project.id : null) : null;
  const actionW = 210;
  // iPad (interface large au doigt, sans survol): mêmes actions qu'au survol, révélées en glissant la carte vers la gauche,
  // avec le tiroir du téléphone.
  const [touchOnly] = useState(() => window.matchMedia('(hover: none)').matches);
  const swipeWide = !isMobile && touchOnly;

  useSwipeActions({ cardRef, contentRef, actionsRef, haloWhiteRef, actionW, isMobile: isMobile || swipeWide, setActionsOpen, syncHalo: true, variant: isMobile ? 'mobile' : 'wide', keepLayers: swipeWide });

  const isFirstMount = useRef(true);
  useEffect(() => afterEntrance(() => { isFirstMount.current = false; }), []);

  const tx = actionsOpen ? actionW : 0;
  const ease = 'transform 0.6s cubic-bezier(0.2, 1.5, 0.4, 1)';
  const drawer = (
      <div ref={actionsRef} style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: `${actionW}px`,
        display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: '12px', paddingRight: '20px',
        transform: `translateX(${actionW - tx}px)`, transition: ease, zIndex: 1
      }}>
        {/* Red/pink glow */}
        <div style={{ position: 'absolute', left: '100%', top: '50%', width: '400px', height: '280px', borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(216,49,82,0.8) 0%, rgba(216,49,82,0.3) 40%, rgba(216,49,82,0) 70%)', mixBlendMode: 'screen', pointerEvents: 'none', transform: 'translate(-17%, -50%) scaleX(1.22)' }}/>
        {!confirmDelete && <button className="font-bebas-bold uppercase" style={{ background: 'none', border: 'none', color: confirmRevert ? '#d83152' : '#8B9B99', fontSize: '15px', cursor: 'pointer', padding: '6px 2px', letterSpacing: '0.03em', textShadow: confirmRevert ? '0 0 12px rgba(216,49,82,0.4)' : 'none', whiteSpace: 'nowrap', transition: 'color 0.2s, text-shadow 0.2s' }} onClick={() => { if (confirmRevert) { setActionsOpen(false); revertProject(project.id); setConfirmRevert(false); } else { setConfirmRevert(true); setConfirmDone(false); setConfirmDelete(false); setTimeout(() => setConfirmRevert(false), 3000); } }}>{confirmRevert ? t('revertConfirm') : t('revert')}</button>}
        {!confirmDelete && <button className="font-bebas-bold uppercase" style={{ background: 'none', border: 'none', color: confirmDone ? '#d83152' : '#8B9B99', fontSize: '15px', cursor: 'pointer', padding: '6px 2px', letterSpacing: '0.03em', textShadow: confirmDone ? '0 0 12px rgba(216,49,82,0.4)' : 'none', whiteSpace: 'nowrap', transition: 'color 0.2s, text-shadow 0.2s' }} onClick={() => { if (confirmDone) { setActionsOpen(false); advanceProject(project.id); setConfirmDone(false); } else { setConfirmDone(true); setConfirmRevert(false); setConfirmDelete(false); setTimeout(() => setConfirmDone(false), 3000); } }}>{confirmDone ? t('archiveConfirm') : t('archive')}</button>}
        {confirmDelete ? <button className="font-bebas-bold" style={{ background: 'none', border: 'none', color: '#FF3B30', fontSize: '15px', cursor: 'pointer', letterSpacing: '0.03em', textShadow: '0 0 12px rgba(255,59,48,0.4)', padding: '6px 2px', whiteSpace: 'nowrap' }} onClick={() => { deleteProject(project.id); }}>{t('deleteConfirm')}</button> : <button style={{ background: 'none', border: 'none', padding: '6px 2px', cursor: 'pointer', color: '#FF3B30', filter: 'drop-shadow(0 0 4px rgba(255,59,48,0.3))', position: 'relative', top: '-3px' }} onClick={() => { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }}><TrashIcon/></button>}
      </div>
  );

  if (isMobile) {
    return (
      <div ref={cardRef} data-open={actionsOpen} data-project-id={project.id} className={isFirstMount.current ? 'animate-card-in' : ''}
        style={{ position: 'relative', margin: '0 12px', marginBottom: '40px', ...(isFirstMount.current ? { animationDelay: `${0.05 + index * 0.12}s` } : {}), WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
      >
        {/* Layer 2: fond (coins droits) + halos + contours flous */}
        <div style={{ position: 'absolute', top: 0, left: '-40px', right: 0, bottom: '-15px', borderRadius: '0px', overflow: 'hidden', background: 'rgba(0,0,0,0.14)', WebkitMaskImage: 'linear-gradient(to right, black, black calc(100% - 50px), transparent), linear-gradient(to bottom, transparent, black 50px, black calc(100% - 50px), transparent)', WebkitMaskComposite: 'destination-in', maskImage: 'linear-gradient(to right, black, black calc(100% - 50px), transparent), linear-gradient(to bottom, transparent, black 50px, black calc(100% - 50px), transparent)', maskComposite: 'intersect', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: '50%', bottom: '-350px', width: '700px', height: '500px', borderRadius: '50%', background: 'radial-gradient(ellipse 60% 45%, rgba(39,80,84,0.6) 0%, rgba(39,80,84,0.3) 40%, rgba(39,80,84,0) 70%)', mixBlendMode: 'screen', pointerEvents: 'none', transform: 'translateX(-50%)' }}/>
          <div style={{ position: 'absolute', left: '-400px', bottom: '-400px', width: '660px', height: '660px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(15,117,143,0.4) 0%, rgba(15,117,143,0.1) 40%, rgba(15,117,143,0) 70%)', pointerEvents: 'none' }}/>
        </div>
        {/* Layer 1.5: masque (coins droits) + halo blanc central */}
        <div ref={haloWhiteRef} style={{ position: 'absolute', top: '-5px', left: '-40px', right: 0, bottom: '-5px', borderRadius: '0px', overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: '-500px', top: '50%', transform: 'translateY(-50%)', width: '660px', height: '660px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 40%, rgba(255,255,255,0) 70%)', pointerEvents: 'none' }}/>
        </div>
        {/* Layer 1 : contenu (rangée 2a adaptée au mobile : chiffre, nom, tags + date, jauge) */}
        <div ref={contentRef} style={{ transform: `translateX(${-tx}px)`, transition: ease, padding: '5px 5px', position: 'relative', zIndex: 1, willChange: 'transform', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
          {actionsOpen && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 10 }}
              onClick={() => { setActionsOpen(false); }}
            />
          )}
          <EditRow index={index} compact project={project} days={days} status={status} editPrefs={editPrefs} dateLabel={dateLabel} onClick={() => { if (!actionsOpen) onSelect(project); }}/>
        </div>
        {drawer}
      </div>
    );
  }

  // Desktop layout : coque de carte inchangée (fond, halo, filet, survol), rangée 2a à l'intérieur.
  // Le padding interne (4 px / 18 px) s'ajoute à celui de la carte (16 px) pour donner 20 px / 34 px.
  const desktopCard = (
    <div className="project-card py-4 px-4 mb-3 hover:bg-cream-dark/30 overflow-hidden animate-card-in border-b border-adaptive"
      style={{ animationDelay: `${0.05 + index * 0.12}s` }}>
      <div className="card-info-flare" style={{ left: '-350px', top: '0px', background: 'radial-gradient(circle, rgba(216,175,76,1) 0%, rgba(216,175,76,0.5) 35%, transparent 65%)' }}></div>
      <EditRow index={index} project={project} days={days} status={status} editPrefs={editPrefs} dateLabel={dateLabel} onClick={() => { if (!actionsOpen) onSelect(project); }} dateActive={editingShotDate}
        onDateClick={(e) => { if (!project.shotAt) return; e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setPickerPos({ top: r.bottom + 4, left: r.left }); originalDateRef.current = project.shotAt; setEditingShotDate(p => !p); }}/>
    </div>
  );
  return (
    <div className="card-glow-wrap" ref={swipeWide ? cardRef : undefined} data-open={swipeWide ? actionsOpen : undefined}>
    {swipeWide ? (
      <div ref={contentRef} style={{ position: 'relative', zIndex: 1, transform: `translateX(${-tx}px)`, transition: ease, willChange: 'transform', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
        {actionsOpen && <div style={{ position: 'absolute', inset: 0, zIndex: 10 }} onClick={() => setActionsOpen(false)}/>}
        {desktopCard}
      </div>
    ) : desktopCard}
    {/* iPad: tiroir préparé d'avance pour la puce graphique, comme la carte qui glisse */}
    {swipeWide && React.cloneElement(drawer, { style: { ...drawer.props.style, willChange: 'transform' } })}
    <div className="hidden lg:flex items-center gap-4 card-actions" style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)' }}>
      <button onClick={handleRevert} className="font-bebas-bold uppercase" style={{ background: 'none', border: 'none', color: confirmRevert ? '#d83152' : colorCharcoal, fontSize: '16px', cursor: 'pointer', padding: '6px 2px', letterSpacing: '0.03em', transition: 'text-shadow 0.2s, color 0.2s', textShadow: confirmRevert ? '0 0 12px rgba(216,49,82,0.4), 0 0 30px rgba(216,49,82,0.15)' : 'none' }} onMouseEnter={e => { e.target.style.color = '#FAF9F7'; e.target.style.textShadow = '0 0 12px rgba(255,255,255,0.25), 0 0 30px rgba(255,255,255,0.1)'; }} onMouseLeave={e => { if (!confirmRevert) { e.target.style.color = colorCharcoal; e.target.style.textShadow = 'none'; } else { e.target.style.color = '#d83152'; e.target.style.textShadow = '0 0 12px rgba(216,49,82,0.4), 0 0 30px rgba(216,49,82,0.15)'; } }}>{confirmRevert ? t('cancelEditingConfirm') : t('cancelEditing')}</button>
      <button onClick={handleDone} className="font-bebas-bold uppercase" style={{ background: 'none', border: 'none', color: confirmDone ? '#d83152' : colorCharcoal, fontSize: '16px', cursor: 'pointer', padding: '6px 2px', letterSpacing: '0.03em', transition: 'text-shadow 0.2s, color 0.2s', textShadow: confirmDone ? '0 0 12px rgba(216,49,82,0.4), 0 0 30px rgba(216,49,82,0.15)' : 'none' }} onMouseEnter={e => { e.target.style.color = '#FAF9F7'; e.target.style.textShadow = '0 0 12px rgba(255,255,255,0.25), 0 0 30px rgba(255,255,255,0.1)'; }} onMouseLeave={e => { if (!confirmDone) { e.target.style.color = colorCharcoal; e.target.style.textShadow = 'none'; } else { e.target.style.color = '#d83152'; e.target.style.textShadow = '0 0 12px rgba(216,49,82,0.4), 0 0 30px rgba(216,49,82,0.15)'; } }}>{confirmDone ? t('archiveConfirm') : t('archive')}</button>
      {confirmDelete ? <button onClick={handleDelete} className="font-bebas-bold" style={{ background: 'none', border: 'none', color: '#FF3B30', fontSize: '16px', cursor: confirmReady ? 'pointer' : 'default', letterSpacing: '0.03em', transition: 'color 0.3s', textShadow: confirmReady ? '0 0 12px rgba(255,59,48,0.4)' : 'none', padding: '6px 2px' }}>{t('deleteConfirm')}</button> : <button onClick={handleDelete} className="p-2 trash-btn text-red-500" title={t('delete')}><TrashIcon/></button>}
    </div>
    {editingShotDate && project.shotAt && ReactDOM.createPortal(
      <React.Fragment>
        <div onClick={() => { if (originalDateRef.current) updateProject(project.id, { shotAt: originalDateRef.current }); setEditingShotDate(false); }} style={{ position: 'fixed', inset: 0, zIndex: 9998 }}/>
        <div style={{ position: 'fixed', top: pickerPos.top, left: pickerPos.left, zIndex: 9999 }}>
          <DateWheelPicker dropDown title={t('editedDate')} date={new Date(project.shotAt)} onChange={d => { updateProject(project.id, { shotAt: d.toISOString() }); }} onCancel={d => { updateProject(project.id, { shotAt: d.toISOString() }); }} onClose={() => setEditingShotDate(false)} />
        </div>
      </React.Fragment>,
      document.body
    )}
    </div>
  );
};

export const DoneCard = ({ project, index = 0, editPrefs = EDIT_LIST_DEFAULTS }) => {
  const { revertProject, deleteProject, prefs } = useStore();
  const { t } = useLang();
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const colorCharcoal = '#8B9B99';
  // Même rangée que la liste du haut, atténuée par l'opacité de la coque (0.5) et sans les couleurs
  // d'alerte (toujours neutre). Le chiffre dit en combien de jours le projet a été livré : durée de la
  // retouche, figée à l'archivage. La date reste la date d'édition.
  const frozenDays = editDaysFrozen(project);
  const doneDateLabel = project.shotAt ? formatDateShort(project.shotAt) : '- - -';
  const isMobile = useIsMobile();
  const cardRef2 = useRef(null);
  const contentRef2 = useRef(null);
  const actionsRef2 = useRef(null);
  const [actionsOpen2, setActionsOpen2] = useState(false);
  const actionW2 = 160;
  // iPad (interface large au doigt): même tiroir qu'au téléphone (Réactiver, corbeille), en glissant la carte vers la gauche.
  const [touchOnly2] = useState(() => window.matchMedia('(hover: none)').matches);
  const swipeWide2 = !isMobile && touchOnly2;

  useEffect(() => {
    const card = cardRef2.current;
    if (!card || !(isMobile || swipeWide2)) return;
    let startX = 0, startY = 0, locked = false, mode = null, open = false, px = 0, lastMoveX = 0, lastMoveT = 0, velocity = 0;
    const ease = 'transform 0.6s cubic-bezier(0.2, 1.5, 0.4, 1)';
    const setTx = (v) => { px = v; if (contentRef2.current) contentRef2.current.style.transform = `translateX(${-v}px)`; if (actionsRef2.current) actionsRef2.current.style.transform = `translateX(${actionW2 - v}px)`; };
    let rafId = null, pendingTx = null;
    const rafSetTx = (v) => { pendingTx = v; if (!rafId) { rafId = requestAnimationFrame(() => { rafId = null; if (pendingTx !== null) setTx(pendingTx); }); } };
    const onStart = (e) => { startX = e.touches[0].clientX; startY = e.touches[0].clientY; locked = false; mode = null; lastMoveX = startX; lastMoveT = Date.now(); velocity = 0; if (contentRef2.current) contentRef2.current.style.transition = 'none'; if (actionsRef2.current) actionsRef2.current.style.transition = 'none'; };
    const onMove = (e) => {
      const dx = e.touches[0].clientX - startX; const dy = e.touches[0].clientY - startY;
      const now = Date.now(); const dt = now - (lastMoveT || now);
      if (dt > 0) velocity = (e.touches[0].clientX - (lastMoveX || e.touches[0].clientX)) / dt;
      lastMoveX = e.touches[0].clientX; lastMoveT = now;
      if (!locked) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; if (Math.abs(dy) > Math.abs(dx)) { mode = null; locked = true; if (open) { open = false; if (contentRef2.current) contentRef2.current.style.transition = ease; if (actionsRef2.current) actionsRef2.current.style.transition = ease; setTx(0); setTimeout(() => setActionsOpen2(false), 600); } return; } locked = true; mode = open ? 'close' : (dx < 0 ? 'open' : null); }
      if (mode === 'close') { e.preventDefault(); rafSetTx(Math.max(0, Math.min(actionW2, actionW2 - dx))); }
      else if (mode === 'open') { e.preventDefault(); rafSetTx(Math.min(actionW2, Math.max(0, Math.abs(dx) - 8))); }
    };
    const onEnd = () => {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; } if (pendingTx !== null) { setTx(pendingTx); pendingTx = null; }
      if (mode === 'close' || mode === 'open') { const v = velocity || 0; const snap = mode === 'open' ? (px > actionW2 * 0.3 || v < -0.3) : (px > actionW2 * 0.7 && v > -0.3); open = snap; if (contentRef2.current) contentRef2.current.style.transition = ease; if (actionsRef2.current) actionsRef2.current.style.transition = ease; setTx(snap ? actionW2 : 0); setTimeout(() => setActionsOpen2(snap), 600); }
      else { if (contentRef2.current) contentRef2.current.style.transition = ease; if (actionsRef2.current) actionsRef2.current.style.transition = ease; }
      mode = null;
    };
    // Tiroir refermé par le calque (toucher la carte): l'état local suit, sinon le glissement suivant partait en mode
    // fermeture et la carte sautait d'un coup en position ouverte.
    const attrObs = new MutationObserver(() => { if (card.dataset.open !== 'true') open = false; });
    attrObs.observe(card, { attributes: true, attributeFilter: ['data-open'] });
    card.addEventListener('touchstart', onStart, { passive: true }); card.addEventListener('touchmove', onMove, { passive: false }); card.addEventListener('touchend', onEnd, { passive: true });
    return () => { if (rafId) cancelAnimationFrame(rafId); attrObs.disconnect(); card.removeEventListener('touchstart', onStart); card.removeEventListener('touchmove', onMove); card.removeEventListener('touchend', onEnd); };
  }, [isMobile]);

  const handleRevert = (e) => {
    e.stopPropagation(); e.preventDefault();
    if (confirmRevert) { revertProject(project.id); setConfirmRevert(false); } else { setConfirmRevert(true); setConfirmDelete(false); setTimeout(() => setConfirmRevert(false), 3000); }
  };
  const handleDelete = (e) => {
    e.stopPropagation(); e.preventDefault();
    if (confirmDelete) { deleteProject(project.id); } else { setConfirmDelete(true); setConfirmRevert(false); setTimeout(() => setConfirmDelete(false), 3000); }
  };

  const tx2 = actionsOpen2 ? actionW2 : 0;
  const ease2 = 'transform 0.6s cubic-bezier(0.2, 1.5, 0.4, 1)';
  // Tiroir (Réactiver, corbeille), commun au téléphone et à l'iPad
  const drawer2 = (
      <div ref={actionsRef2} style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, width: `${actionW2}px`,
        display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: '12px', paddingRight: '20px',
        transform: `translateX(${actionW2 - tx2}px)`, transition: ease2, zIndex: 1
      }}>
        {/* Red/pink glow */}
        <div style={{ position: 'absolute', left: '100%', top: '50%', width: '400px', height: '280px', borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(216,49,82,0.8) 0%, rgba(216,49,82,0.3) 40%, rgba(216,49,82,0) 70%)', mixBlendMode: 'screen', pointerEvents: 'none', transform: 'translate(-17%, -50%) scaleX(1.22)' }}/>
        {!confirmDelete && <button className="font-bebas-bold uppercase" style={{ background: 'none', border: 'none', color: confirmRevert ? '#d83152' : '#8B9B99', fontSize: '15px', cursor: 'pointer', padding: '6px 2px', letterSpacing: '0.03em', textShadow: confirmRevert ? '0 0 12px rgba(216,49,82,0.4)' : 'none', whiteSpace: 'nowrap', transition: 'color 0.2s, text-shadow 0.2s' }} onClick={() => { if (confirmRevert) { setActionsOpen2(false); revertProject(project.id); setConfirmRevert(false); } else { setConfirmRevert(true); setConfirmDelete(false); setTimeout(() => setConfirmRevert(false), 3000); } }}>{confirmRevert ? t('reactivateConfirm') : t('reactivate')}</button>}
        {confirmDelete ? <button className="font-bebas-bold" style={{ background: 'none', border: 'none', color: '#FF3B30', fontSize: '15px', cursor: 'pointer', letterSpacing: '0.03em', textShadow: '0 0 12px rgba(255,59,48,0.4)', padding: '6px 2px', whiteSpace: 'nowrap' }} onClick={() => { deleteProject(project.id); }}>{t('deleteConfirm')}</button> : <button style={{ background: 'none', border: 'none', padding: '6px 2px', cursor: 'pointer', color: '#FF3B30', filter: 'drop-shadow(0 0 4px rgba(255,59,48,0.3))', position: 'relative', top: '-3px' }} onClick={() => { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }}><TrashIcon/></button>}
      </div>
  );

  if (isMobile) {
    return (
      <div ref={cardRef2} data-open={actionsOpen2} style={{ position: 'relative', margin: '0 12px', marginBottom: '40px', opacity: 0.5, WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}>
        {/* Layer 2: fond (coins droits) + halos + contours flous */}
        <div style={{ position: 'absolute', top: 0, left: '-40px', right: 0, bottom: '-15px', borderRadius: '0px', overflow: 'hidden', background: 'rgba(0,0,0,0.14)', WebkitMaskImage: 'linear-gradient(to right, black, black calc(100% - 50px), transparent), linear-gradient(to bottom, transparent, black 50px, black calc(100% - 50px), transparent)', WebkitMaskComposite: 'destination-in', maskImage: 'linear-gradient(to right, black, black calc(100% - 50px), transparent), linear-gradient(to bottom, transparent, black 50px, black calc(100% - 50px), transparent)', maskComposite: 'intersect', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: '50%', bottom: '-350px', width: '700px', height: '500px', borderRadius: '50%', background: 'radial-gradient(ellipse 60% 45%, rgba(39,80,84,0.6) 0%, rgba(39,80,84,0.3) 40%, rgba(39,80,84,0) 70%)', mixBlendMode: 'screen', pointerEvents: 'none', transform: 'translateX(-50%)' }}/>
          <div style={{ position: 'absolute', left: '-400px', bottom: '-400px', width: '660px', height: '660px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(15,117,143,0.4) 0%, rgba(15,117,143,0.1) 40%, rgba(15,117,143,0) 70%)', pointerEvents: 'none' }}/>
        </div>
        {/* Layer 1.5: masque (coins droits) + halo blanc central */}
        <div style={{ position: 'absolute', top: '-5px', left: '-40px', right: 0, bottom: '-5px', borderRadius: '0px', overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: '-500px', top: '50%', transform: 'translateY(-50%)', width: '660px', height: '660px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 40%, rgba(255,255,255,0) 70%)', pointerEvents: 'none' }}/>
        </div>
        {/* Layer 1: contenu */}
        <div ref={contentRef2} style={{ transform: `translateX(${-tx2}px)`, transition: ease2, padding: '5px 5px', position: 'relative', zIndex: 1, willChange: 'transform', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
          {actionsOpen2 && <div style={{ position: 'absolute', inset: 0, zIndex: 10 }} onClick={() => setActionsOpen2(false)}/>}
          <EditRow index={index} compact project={project} days={frozenDays} status='normal' editPrefs={editPrefs} dateLabel={doneDateLabel}/>
        </div>
        {drawer2}
      </div>
    );
  }

  const desktopCard2 = (
    <div className="project-card py-4 px-4 mb-3 hover:bg-cream-dark/30 overflow-hidden border-b border-adaptive" style={{ opacity: 0.5 }}>
      <EditRow index={index} project={project} days={frozenDays} status='normal' editPrefs={editPrefs} dateLabel={doneDateLabel}/>
    </div>
  );
  return (
    <div className="card-glow-wrap" ref={swipeWide2 ? cardRef2 : undefined} data-open={swipeWide2 ? actionsOpen2 : undefined}>
    {swipeWide2 ? (
      <div ref={contentRef2} style={{ position: 'relative', zIndex: 1, transform: `translateX(${-tx2}px)`, transition: ease2, willChange: 'transform', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
        {actionsOpen2 && <div style={{ position: 'absolute', inset: 0, zIndex: 10 }} onClick={() => setActionsOpen2(false)}/>}
        {desktopCard2}
      </div>
    ) : desktopCard2}
    {/* Atténué comme la carte, ainsi que l'est tout le tiroir du téléphone (opacité 0,5 de la carte) */}
    {swipeWide2 && React.cloneElement(drawer2, { style: { ...drawer2.props.style, opacity: 0.5, willChange: 'transform' } })}
    <div className="hidden lg:flex items-center gap-4 card-actions" style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)' }}>
      <button onClick={handleRevert} className="font-bebas-bold uppercase" style={{ background: 'none', border: 'none', color: confirmRevert ? '#d83152' : colorCharcoal, fontSize: '16px', cursor: 'pointer', padding: '6px 2px', letterSpacing: '0.03em', transition: 'text-shadow 0.2s, color 0.2s', textShadow: confirmRevert ? '0 0 12px rgba(216,49,82,0.4), 0 0 30px rgba(216,49,82,0.15)' : 'none' }} onMouseEnter={e => { e.target.style.color = '#FAF9F7'; e.target.style.textShadow = '0 0 12px rgba(255,255,255,0.25), 0 0 30px rgba(255,255,255,0.1)'; }} onMouseLeave={e => { if (!confirmRevert) { e.target.style.color = colorCharcoal; e.target.style.textShadow = 'none'; } else { e.target.style.color = '#d83152'; e.target.style.textShadow = '0 0 12px rgba(216,49,82,0.4), 0 0 30px rgba(216,49,82,0.15)'; } }}>{confirmRevert ? t('reactivateConfirm') : t('reactivate')}</button>
      <button onClick={handleDelete} className={`p-2 trash-btn text-red-500`} title={t('delete')}><TrashIcon/></button>
    </div>
    </div>
  );
};
