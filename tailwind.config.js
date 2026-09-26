/** @type {import('tailwindcss').Config} */
// Reprend exactement la configuration inline de l'ancien index.html (Tailwind Play CDN).
export default {
  content: ['./index.html', './site/*.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        orange: { DEFAULT: '#E07A2B', light: '#ffe26b', dark: '#C4611A' },
        cream: { DEFAULT: 'var(--bg-primary)', dark: 'var(--bg-secondary)' },
        charcoal: { DEFAULT: 'var(--text-primary)', light: 'var(--text-secondary)', muted: 'var(--text-muted)' },
        red: { 500: '#f4143d' },
        blue: { 500: '#7dd3c6' },
      },
      fontFamily: { bebas: ['Bebas Neue', 'sans-serif'], avenir: ['Montserrat', 'sans-serif'] },
    },
  },
  plugins: [],
};
