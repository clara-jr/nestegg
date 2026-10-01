/**
 * Bus mínimo de escrituras de almacenamiento.
 *
 * La mayoría de mutaciones de datos ya disparan DATA_CHANGED_EVENT o
 * PROFILE_CHANGED_EVENT, pero los setters de los hooks useLocalStorage /
 * useProfileLocalStorage escriben en localStorage sin emitir ningún evento
 * (para no provocar refrescos en cadena). Este bus permite a la capa de
 * sincronización con Drive enterarse de esas escrituras sin acoplar
 * sharedStore/profiles con driveSync ni disparar refescres de UI.
 */

export const DATA_WRITE_EVENT = 'nestegg-data-write';

/** Notifica (sin payload) que se ha escrito un dato en el almacenamiento local. */
export function notifyDataWrite(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(DATA_WRITE_EVENT));
}