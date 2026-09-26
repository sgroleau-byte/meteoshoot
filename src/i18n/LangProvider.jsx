import { createContext, useContext, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { TRANSLATIONS, getDefaultLang } from '../shared/translations.js';

// ===== LANGUAGE CONTEXT =====
export const LangContext = createContext();
export const useLang = () => useContext(LangContext);

export const LangProvider = ({ children }) => {
  const [lang, setLangState] = useState(getDefaultLang());
  const setLang = (newLang) => {
    if (TRANSLATIONS[newLang]) {
      setLangState(newLang);
      localStorage.setItem('sp-lang', newLang);
      // Sync lang to Supabase user metadata (for bilingual email templates)
      supabase.auth.updateUser({ data: { lang: newLang } });
    }
  };
  const tr = (key) => {
    const dict = TRANSLATIONS[lang];
    return (dict && dict[key] !== undefined) ? dict[key] : (TRANSLATIONS.fr[key] || key);
  };
  return <LangContext.Provider value={{ lang, setLang, t: tr }}>{children}</LangContext.Provider>;
};
