// Point d'entrée Vite: styles, polices embarquées, puis l'application.
import './styles/app.css';
import './native/init.js';
import '@fontsource/montserrat/300.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/oswald/300.css';
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/600.css';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './auth/AuthProvider.jsx';
import { LangProvider } from './i18n/LangProvider.jsx';
import { AppWithAuth } from './components/App.jsx';
import { reloadForUpdate } from './shared/updateReload.js';

// Nouvelle version déployée pendant que la page était ouverte: Vite signale l'échec du chargement différé, on recharge une fois.
window.addEventListener('vite:preloadError', (e) => { if (reloadForUpdate()) e.preventDefault(); });

createRoot(document.getElementById('root')).render(<AuthProvider><LangProvider><AppWithAuth/></LangProvider></AuthProvider>);
