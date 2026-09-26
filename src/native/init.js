// Réglages natifs au démarrage (sans effet sur le web).
import { StatusBar, Style } from '@capacitor/status-bar';
import { isNative, platform } from './platform.js';

if (isNative) {
  document.documentElement.classList.add('native', 'native-' + platform);
  // Bande opaque sous la barre de statut (zone sûre du haut): le contenu qui défile ne passe plus dessous.
  const mask = document.createElement('div');
  mask.className = 'native-status-bar-mask';
  document.body.appendChild(mask);
  // Texte clair sur fond sombre, comme la barre « black-translucent » de l'app web installée.
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
}
