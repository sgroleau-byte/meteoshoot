// Réglages natifs au démarrage (sans effet sur le web).
import { StatusBar, Style } from '@capacitor/status-bar';
import { isNative } from './platform.js';

if (isNative) {
  // Texte clair sur fond sombre, comme la barre « black-translucent » de l'app web installée.
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
}
