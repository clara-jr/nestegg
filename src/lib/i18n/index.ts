import { useCallback, useEffect, useState } from 'react';
import { translations, type Lang } from './translations';
import { interpolate } from './util';

export type { Lang } from './translations';

export const LANG_STORAGE_KEY = 'nestegg-lang';
export const LANG_CHANGED_EVENT = 'nestegg-lang-changed';

export const DEFAULT_LANG: Lang = 'es';

/** Traducción válida conocida para una clave (evita interpolaciones rotas). */
function rawTranslate(lang: Lang, key: string): string | undefined {
  return translations[lang]?.[key] ?? translations[DEFAULT_LANG]?.[key];
}

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const text = rawTranslate(lang, key) ?? key;
  return interpolate(text, vars);
}

export function getStoredLang(): Lang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (stored === 'es' || stored === 'en' || stored === 'fr') return stored;
  } catch {}
  return DEFAULT_LANG;
}

export function setLanguage(lang: Lang): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {}
  window.dispatchEvent(new CustomEvent(LANG_CHANGED_EVENT));
}

/** Traduce el nombre mostrado de una categoría de gasto. Las categorías se
 *  guardan en español («Alimentación»…) pero se muestran en el idioma activo.
 *  Las categorías personalizadas (no conocidas) se devuelven sin traducir. */
export function translateCategory(lang: Lang, category?: string | null): string {
  if (!category) return '';
  return rawTranslate(lang, `categories.${category}`) ?? category;
}

/** Aplica las traducciones a los nodos del DOM marcados con `data-i18n` (texto),
 *  `data-i18n-aria`, `data-i18n-title`, `data-i18n-placeholder` y `data-i18n-meta`
 *  (actualiza `content` de las etiquetas <meta>). */
export function applyStaticI18n(): void {
  if (typeof document === 'undefined') return;
  const lang = getStoredLang();
  document.documentElement.lang = lang;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    let vars;
    try {
      vars = JSON.parse(el.getAttribute('data-i18n-vars') ?? '');
    } catch {}
    const text = translate(lang, key, vars);
    if (el.textContent !== text) el.textContent = text;
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach(el => {
    const key = el.getAttribute('data-i18n-aria');
    if (!key) return;
    el.setAttribute('aria-label', translate(lang, key));
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (!key) return;
    el.setAttribute('title', translate(lang, key));
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (!key) return;
    el.setAttribute('placeholder', translate(lang, key));
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-meta]').forEach(el => {
    const key = el.getAttribute('data-i18n-meta');
    if (!key) return;
    el.setAttribute('content', translate(lang, key));
  });
}

export function useI18n(): {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  tCategory: (category?: string | null) => string;
} {
  const [lang, setLangState] = useState<Lang>(getStoredLang);

  useEffect(() => {
    const sync = () => setLangState(getStoredLang());
    window.addEventListener(LANG_CHANGED_EVENT, sync);
    return () => window.removeEventListener(LANG_CHANGED_EVENT, sync);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLanguage(next);
    setLangState(next);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  );

  const tCategory = useCallback((category?: string | null) => translateCategory(lang, category), [lang]);

  return { lang, setLang, t, tCategory };
}

/** Nombre de un mes según el idioma activo («Enero» → «January»…). */
export function monthNames(lang: Lang): string[] {
  return translate(lang, 'calendar.months').split(',');
}

/** Iniciales de los días de la semana según el idioma activo (L M X J V S D). */
export function dayHeaders(lang: Lang): string[] {
  return translate(lang, 'calendar.dayHeaders').split(',');
}

/** Locale BCP-47 asociado a un idioma de la app. */
export function localeOf(lang: Lang): string {
  return lang === 'es' ? 'es-ES' : lang === 'en' ? 'en-GB' : 'fr-FR';
}

/** Formatea una fecha corta (día + mes) en el idioma activo. */
export function formatDayLocalized(lang: Lang, date: string, opts?: Intl.DateTimeFormatOptions): string {
  const iso = date.length === 10 ? date : `${date}-01`;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(localeOf(lang), opts);
}

/** Formatea una fecha completa (día + mes + año) en el idioma activo. */
export function formatDateLocalized(lang: Lang, date: string, opts?: Intl.DateTimeFormatOptions): string {
  const iso = date.length === 10 ? date : `${date}-01`;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(localeOf(lang), opts);
}

/** Formatea un objeto Date en el idioma activo. */
export function formatDateObjLocalized(lang: Lang, date: Date, opts?: Intl.DateTimeFormatOptions): string {
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(localeOf(lang), opts);
}