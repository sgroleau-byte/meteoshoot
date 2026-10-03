import { useEffect, useState } from 'react';

// Largeur de la fenêtre, mise à jour au redimensionnement et à la rotation de l'iPad.
export const useViewportWidth = () => {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
};
