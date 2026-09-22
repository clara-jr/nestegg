import { Select } from './common/form/Select';
import { useI18n, type Lang } from '../lib/i18n';

const LANG_OPTIONS: Array<{ value: Lang; label: string }> = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
];

function GlobeIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

export function LanguageSelector() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="items-center gap-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 pb-2">{t('footer.language')}</p>
      <Select
        value={lang}
        onChange={v => setLang(v as Lang)}
        ariaLabel={t('footer.languageAria')}
        className="w-33"
        size="sm"
        leadingIcon={<GlobeIcon />}
        options={LANG_OPTIONS}
      />
    </div>
  );
}