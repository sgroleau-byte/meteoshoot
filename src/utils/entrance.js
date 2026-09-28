// Entrée de l'interface après le splash. Tant que la racine porte la classe ms-hold (voir index.html),
// les animations d'entrée sont retenues; la révélation retire la classe et émet l'événement
// « meteoshoot:reveal ». afterEntrance(cb) exécute cb un peu après cette révélation (ou tout de suite
// après le délai si le splash est déjà parti), pour marquer la fin de la première apparition.
export function afterEntrance(cb, extraMs = 600) {
  let timer = null;
  const start = () => { timer = setTimeout(cb, extraMs); };
  const root = typeof document !== 'undefined' ? document.getElementById('root') : null;
  if (root && root.classList.contains('ms-hold')) {
    window.addEventListener('meteoshoot:reveal', start, { once: true });
  } else {
    start();
  }
  return () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener('meteoshoot:reveal', start);
  };
}
