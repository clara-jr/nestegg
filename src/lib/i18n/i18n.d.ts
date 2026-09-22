declare module 'i18n' {
  interface I18nConfigureOptions {
    locales?: string[];
    defaultLocale?: string;
    directory?: string;
    directoryPermissions?: string;
    extension?: string;
    prefix?: string;
    objectNotation?: string | false;
    syncFiles?: boolean;
    updateFiles?: boolean;
    retryInDefaultLocale?: boolean;
    fallbacks?: Record<string, string>;
    autoReload?: boolean;
    cookiename?: string;
    register?: boolean;
    missingKeyFn?: (locale: string, value: string) => string;
    logDebugFn?: (...args: unknown[]) => void;
    logWarnFn?: (...args: unknown[]) => void;
    logErrorFn?: (...args: unknown[]) => void;
  }

  interface I18nSingleton {
    version: string;
    configure(options: I18nConfigureOptions): void;
    setLocale(object: string | Record<string, unknown>, locale?: string): string;
    getLocale(request?: unknown): string;
    getCatalog(object?: unknown, locale?: string): Record<string, string>;
    getLocales(): string[];
    __(
      phrase: string | { phrase: string; locale?: string },
      ...args: unknown[]
    ): string;
    __n(...args: unknown[]): string;
    __mf(...args: unknown[]): string;
    __l(phrase: string): string[];
    __h(phrase: string): unknown[];
  }

  const i18n: I18nSingleton;
  export = i18n;
}