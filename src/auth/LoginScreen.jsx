import { useEffect } from 'react';

// LoginScreen — moved to /site/login.html, this redirects there
export const LoginScreen = () => {
  useEffect(() => {
    const here = window.location.pathname + window.location.search;
    window.location.href = (here && here !== '/') ? '/site/login.html?redirect=' + encodeURIComponent(here) : '/site/login.html';
  }, []);
  return <div style={{ position: 'fixed', inset: 0, background: '#181b1e' }}/>;
};
