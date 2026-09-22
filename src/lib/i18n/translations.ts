import es from './locales/es.json';
import en from './locales/en.json';
import fr from './locales/fr.json';

export type Lang = 'es' | 'en' | 'fr';

export type Dict = Record<string, string>;

export const translations: Record<Lang, Dict> = { es, en, fr };