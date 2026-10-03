import { useLayoutEffect, useState } from 'react';

// Facteur de réduction (zoom CSS, au plus 1) pour qu'un contenu de largeur naturelle tienne dans sa boîte.
// La largeur naturelle est mesurée zoom remis à 1 le temps de la lecture (même tâche, donc sans image
// intermédiaire): Safari et Chrome ne rapportent pas de la même façon la taille d'un élément zoomé.
// Le contenu doit être en width: max-content pour que sa largeur soit celle de ce qu'il contient.
export const useFitZoom = (boxRef, contentRef, enabled = true) => {
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    if (!enabled) { setZoom(1); return; }
    const box = boxRef.current, content = contentRef.current;
    if (!box || !content) return;
    const fit = () => {
      const current = content.style.zoom;
      content.style.zoom = '1';
      const natural = content.getBoundingClientRect().width;
      content.style.zoom = current;
      const available = box.clientWidth;
      if (!natural || !available) return;
      const next = Math.min(1, Math.floor((available / natural) * 1000) / 1000);
      setZoom((prev) => (Math.abs(prev - next) > 0.003 ? next : prev));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    ro.observe(content);
    return () => ro.disconnect();
  }, [boxRef, contentRef, enabled]);
  return zoom;
};
