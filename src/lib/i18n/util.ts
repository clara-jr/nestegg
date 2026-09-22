/** Sustituye `{var}` e `~` (NBSP) en un texto traducido. Compartido por el
 *  cliente y por el módulo de servidor (i18n) para garantizar paridad. */
export function interpolate(
  text: string,
  vars?: Record<string, string | number>,
): string {
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text.split('~').join('\u00A0');
}