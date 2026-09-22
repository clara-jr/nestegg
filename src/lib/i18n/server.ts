import { fileURLToPath } from 'node:url';
import i18n from 'i18n';
import type { Lang } from './translations';
import { interpolate } from './util';

/** Módulo exclusivo de Node (build de Astro, scripts y tests). El paquete `i18n`
 *  depende de módulos nativos de Node (fs, url, path) y NO puede importarse dentro
 *  de las islas React ni en el cliente del navegador: el cliente lee los mismos
 *  catálogos JSON (`locales/es.json`...) que `i18n` carga aquí. */
export const I18N_LANGUAGES: Lang[] = ['es', 'en', 'fr'];

i18n.configure({
  locales: I18N_LANGUAGES,
  defaultLocale: 'es',
  directory: fileURLToPath(new URL('./locales', import.meta.url)),
  extension: '.json',
  objectNotation: false,
  syncFiles: false,
  updateFiles: false,
  retryInDefaultLocale: true,
});

/** Idioma activo de la instancia singleton de `i18n`. */
export function getActiveLocale(): string {
  return i18n.getLocale();
}

/** Cambia el idioma activo del singleton (devuelve el idioma efectivo). */
export function setActiveLocale(lang: Lang): string {
  return i18n.setLocale(lang);
}

/** Idiomas disponibles (los detectados de los catálogos por el propio `i18n`). */
export function getLocales(): string[] {
  return i18n.getLocales();
}

/** Catálogo crudo de un idioma, tal y como lo ha cargado `i18n`. */
export function getCatalog(lang: Lang): Record<string, string> {
  const catalog = i18n.getCatalog(lang);
  return typeof catalog === 'object' && catalog !== null ? catalog : {};
}

/** Traduce una clave con la librería `i18n` y aplica la interpolación
 *  (`{var}` → valor, `~` → NBSP) idéntica a la del cliente. */
export function serverTranslate(
  lang: Lang,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const raw = i18n.__({ phrase: key, locale: lang });
  const text = typeof raw === 'string' && raw.length > 0 ? raw : key;
  return interpolate(text, vars);
}

