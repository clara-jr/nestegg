import { describe, it, expect } from 'vitest';
import { translations, type Lang } from '../i18n/translations';
import { translate } from '../i18n';
import {
  getActiveLocale,
  getCatalog,
  getLocales,
  serverTranslate,
  setActiveLocale,
} from '../i18n/server';

const LANGS: Lang[] = ['es', 'en', 'fr'];

describe('i18n (servidor)', () => {
  it('detecta los catálogos de los tres idiomas', () => {
    expect(getLocales().sort()).toEqual(['en', 'es', 'fr']);
  });

  it('carga en cada idioma las mismas claves que el cliente', () => {
    for (const lang of LANGS) {
      const catalog = getCatalog(lang);
      expect(Object.keys(catalog).sort()).toEqual(
        Object.keys(translations[lang]).sort(),
      );
    }
  });

  it('traduce con la librería i18n exactamente igual que el cliente para todas las claves', () => {
    for (const lang of LANGS) {
      const catalog = getCatalog(lang);
      for (const key of Object.keys(catalog)) {
        expect(serverTranslate(lang, key), `${lang}:${key}`).toBe(
          translate(lang, key),
        );
      }
    }
  });

  it('interpola variables y NBSP igual que el cliente', () => {
    const vars = { amount: '32.000 €', age: 67 };
    for (const lang of LANGS) {
      expect(serverTranslate(lang, 'home.preview.withPension', vars)).toBe(
        translate(lang, 'home.preview.withPension', vars),
      );
      expect(serverTranslate(lang, 'home.badge')).toBe(translate(lang, 'home.badge'));
    }
  });

  it('respeta el idioma por defecto y permite cambiar el locale activo', () => {
    const before = getActiveLocale() as Lang;
    setActiveLocale('en');
    expect(getActiveLocale()).toBe('en');
    setActiveLocale(before);
    expect(getActiveLocale()).toBe(before);
  });

  it('devuelve la clave como texto cuando no existe en ningún catálogo', () => {
    expect(serverTranslate('es', 'clave.inexistente')).toBe('clave.inexistente');
    expect(serverTranslate('fr', 'otra.clave.sin.traducir')).toBe(
      'otra.clave.sin.traducir',
    );
  });
});