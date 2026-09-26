import globals from 'globals';
import react from 'eslint-plugin-react';

// Filet de sécurité de la migration: toute variable non déclarée (import manquant, global implicite) est une erreur.
export default [
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, google: 'readonly', isDev: 'readonly' },
    },
    settings: { react: { version: '18.3' } },
    rules: {
      'no-undef': 'error',
      'react/jsx-no-undef': 'error',
      'no-octal': 'error',
      'no-with': 'error',
      'no-dupe-args': 'error',
      'no-delete-var': 'error',
      'no-caller': 'error',
    },
  },
];
