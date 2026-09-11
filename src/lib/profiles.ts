import { useEffect, useRef, useState } from 'react';

/**
 * Perfiles de la aplicación. Cada perfil representa un integrante de la casa y
 * almacena su propio bloque de datos del Agregador de Finanzas (extractos
 * importados, precios y depósitos a plazo) bajo una clave namespaced. Los
 * parámetros de las calculadoras (ahorro, jubilación y hogar) son compartidos
 * por todos los perfiles y viven en la raíz de localStorage.
 */

export interface Profile {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface JointConfig {
  /** Categorías de gasto consideradas «conjuntas» a nivel de hogar. */
  jointCategories: string[];
}

export const STORAGE_KEY_PROFILES = 'nestegg-profiles';
export const STORAGE_KEY_ACTIVE = 'nestegg-active-profile';
export const JOINT_CONFIG_KEY = 'nestegg-joint-config';

export const PROFILE_PREFIX = 'nestegg:p:';
/** Datos del Agregador de Finanzas: únicos que son privados de cada perfil. */
export const PROFILE_DATA_KEYS = [
  'nestegg-investments-v1',
  'nestegg-prices-v1',
  'nestegg-plazos-v1',
] as const;

/** Parámetros de las calculadoras, compartidos por todos los perfiles. */
export const CALCULATOR_DATA_KEYS = [
  'savings-params',
  'savings-initial-inputs',
  'retirement-params',
  'affordability-params',
] as const;

/** Claves globales (no vinculadas a ningún perfil). */
export const GLOBAL_DATA_KEYS = ['nestegg-tab', ...CALCULATOR_DATA_KEYS] as const;

export const BACKUP_VERSION = 2;
// Formato de la copia de un único perfil: el mismo que usaba la app antes de
// los perfiles (localStorage plano con las claves en bruto, sin kind ni profile).
export const PROFILE_BACKUP_VERSION = 1;

/** Evento lanzado cuando cambia el perfil activo o la configuración conjunta. */
export const PROFILE_CHANGED_EVENT = 'nestegg-profile-changed';
/** Evento lanzado cuando cambia cualquier dato de un perfil (para refrescos). */
export const DATA_CHANGED_EVENT = 'nestegg-data-changed';

export const PROFILE_COLORS = [
  '#69cdbd',
  '#a990e2',
  '#ecbe73',
  '#7fd0e8',
  '#ff94a9',
  '#55dcb4',
];

export function profileStorageKey(profileId: string, rawKey: string): string {
  return `${PROFILE_PREFIX}${profileId}:${rawKey}`;
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** True durante el renderizado estático del servidor, donde no hay localStorage. */
function isServer(): boolean {
  return typeof window === 'undefined' || typeof localStorage === 'undefined';
}

function readProfilesRaw(): Profile[] {
  if (isServer()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROFILES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Profile[]) : [];
  } catch {
    return [];
  }
}

/** Mueve al perfil activo (o por defecto) las claves legacy del Agregador que
 *  aún vivan en la raíz de localStorage (p. ej. tras restaurar una copia
 *  antigua). Los parámetros de las calculadoras son compartidos, así que se
 *  quedan en la raíz. */
export function migrateLegacyRootKeys(): void {
  const profiles = readProfilesRaw();
  if (profiles.length === 0) return;
  const activeRaw = localStorage.getItem(STORAGE_KEY_ACTIVE);
  const targetId = profiles.some(p => p.id === activeRaw) ? activeRaw! : profiles[0].id;
  for (const rawKey of PROFILE_DATA_KEYS) {
    const legacyRaw = localStorage.getItem(rawKey);
    if (legacyRaw === null) continue;
    const nsKey = profileStorageKey(targetId, rawKey);
    if (localStorage.getItem(nsKey) === null) {
      localStorage.setItem(nsKey, legacyRaw);
    }
    localStorage.removeItem(rawKey);
  }
}

/** Promueve los parámetros de las calculadoras a la raíz de localStorage
 *  (compartidos por todos los perfiles) y limpia los restos por perfil del
 *  esquema anterior. Prioriza el perfil activo, pero si este no tiene datos y
 *  otro perfil los conserva se recuperan de él para no perder valores. Si ya
 *  existe un valor compartido, lo conserva. */
export function migrateCalculatorKeysToGlobal(): void {
  const profiles = readProfilesRaw();
  if (profiles.length === 0) return;
  const activeRaw = localStorage.getItem(STORAGE_KEY_ACTIVE);
  const targetId = profiles.some(p => p.id === activeRaw) ? activeRaw! : profiles[0].id;
  for (const rawKey of CALCULATOR_DATA_KEYS) {
    if (localStorage.getItem(rawKey) !== null) {
      // Ya hay valor compartido: solo limpiamos los restos por perfil.
      for (const p of profiles) localStorage.removeItem(profileStorageKey(p.id, rawKey));
      continue;
    }
    // Elige el primer perfil que tenga datos, dando prioridad al activo.
    const owner = [...profiles]
      .sort((a, b) => (b.id === targetId ? 1 : 0) - (a.id === targetId ? 1 : 0))
      .find(p => localStorage.getItem(profileStorageKey(p.id, rawKey)) !== null);
    if (!owner) continue;
    localStorage.setItem(rawKey, localStorage.getItem(profileStorageKey(owner.id, rawKey))!);
    for (const p of profiles) localStorage.removeItem(profileStorageKey(p.id, rawKey));
  }
}

/**
 * Asegura que exista un perfil (creando el por defecto si no los hay) y que
 * haya un perfil activo válido, sin ejecutar las migraciones de claves.
 * Devuelve el id del perfil activo.
 */
function ensureAnyProfileId(): string {
  const profiles = readProfilesRaw();
  const defaultProfile: Profile = {
    id: randomId(),
    name: 'Mi perfil',
    color: PROFILE_COLORS[0],
    createdAt: new Date().toISOString(),
  };
  if (profiles.length === 0) {
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify([defaultProfile]));
    localStorage.setItem(STORAGE_KEY_ACTIVE, defaultProfile.id);
    return defaultProfile.id;
  }
  const active = localStorage.getItem(STORAGE_KEY_ACTIVE);
  if (active !== null && profiles.some(p => p.id === active)) return active;
  localStorage.setItem(STORAGE_KEY_ACTIVE, profiles[0].id);
  return profiles[0].id;
}

/**
 * Asegura que exista un perfil (creando el por defecto en el primer arranque)
 * y migra las claves legacy del Agregador de Finanzas (que antes vivían en la
 * raíz) a ese perfil. Devuelve el id del perfil activo.
 */
export function ensureInitialized(): string {
  if (isServer()) return '';
  const activeId = ensureAnyProfileId();
  migrateLegacyRootKeys();
  migrateCalculatorKeysToGlobal();
  return activeId;
}

export function getProfiles(): Profile[] {
  ensureInitialized();
  return readProfilesRaw();
}

export function getProfile(profileId: string): Profile | undefined {
  return getProfiles().find(p => p.id === profileId);
}

export function getActiveProfileId(): string {
  return ensureInitialized();
}

export function getActiveProfile(): Profile | undefined {
  return getProfile(getActiveProfileId());
}

export function setActiveProfileId(profileId: string) {
  if (!getProfile(profileId)) return false;
  localStorage.setItem(STORAGE_KEY_ACTIVE, profileId);
  window.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT, { detail: { profileId } }));
  return true;
}

export function createProfile(name: string): Profile {
  ensureInitialized();
  const profiles = readProfilesRaw();
  const profile: Profile = {
    id: randomId(),
    name: name.trim() || 'Nuevo perfil',
    color: PROFILE_COLORS[profiles.length % PROFILE_COLORS.length],
    createdAt: new Date().toISOString(),
  };
  profiles.push(profile);
  localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));
  window.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT));
  return profile;
}

export function renameProfile(profileId: string, name: string) {
  const profiles = readProfilesRaw();
  const idx = profiles.findIndex(p => p.id === profileId);
  if (idx === -1) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  profiles[idx] = { ...profiles[idx], name: trimmed };
  localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));
  window.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT));
  return true;
}

export function setProfileColor(profileId: string, color: string) {
  const profiles = readProfilesRaw();
  const idx = profiles.findIndex(p => p.id === profileId);
  if (idx === -1) return false;
  const trimmed = color.trim();
  if (!trimmed) return false;
  profiles[idx] = { ...profiles[idx], color: trimmed };
  localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));
  window.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT));
  return true;
}

export function deleteProfile(profileId: string) {
  const profiles = readProfilesRaw();
  const removed = profiles.filter(p => p.id !== profileId);
  if (removed.length === profiles.length) return false;
  for (const rawKey of PROFILE_DATA_KEYS) {
    localStorage.removeItem(profileStorageKey(profileId, rawKey));
  }
  localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(removed));
  if (getActiveProfileId() === profileId) {
    localStorage.setItem(STORAGE_KEY_ACTIVE, removed[0]?.id ?? '');
  }
  window.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT));
  return true;
}

// ---------------------------------------------------------------------------
// Gestión de datos personales de un perfil
// ---------------------------------------------------------------------------

export function getProfileData(profileId: string, rawKey: string): unknown {
  if (isServer()) return undefined;
  const raw = localStorage.getItem(profileStorageKey(profileId, rawKey));
  return raw === null ? undefined : safeParse(raw);
}

export function setProfileData(profileId: string, rawKey: string, value: unknown) {
  localStorage.setItem(profileStorageKey(profileId, rawKey), JSON.stringify(value));
}

export function dispatchDataChanged() {
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT));
}

// ---------------------------------------------------------------------------
// Configuración conjunta (a nivel de hogar, no por perfil)
// ---------------------------------------------------------------------------

export function getJointConfig(): JointConfig {
  if (isServer()) return { jointCategories: [] };
  try {
    const raw = localStorage.getItem(JOINT_CONFIG_KEY);
    if (!raw) return { jointCategories: [] };
    const parsed = JSON.parse(raw) as Partial<JointConfig>;
    return { jointCategories: Array.isArray(parsed.jointCategories) ? parsed.jointCategories : [] };
  } catch {
    return { jointCategories: [] };
  }
}

export function saveJointConfig(config: JointConfig) {
  localStorage.setItem(JOINT_CONFIG_KEY, JSON.stringify(config));
  window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT));
}

// ---------------------------------------------------------------------------
// Copias de seguridad: parciales (un perfil, solo su Agregador) o totales
// ---------------------------------------------------------------------------

export interface BackupPayload {
  app: 'nestegg';
  version: number;
  kind?: 'profile' | 'all';
  exportedAt: string;
  profile?: { id: string; name: string };
  profiles?: Profile[];
  data: Record<string, unknown>;
}

export interface ImportResult {
  kind: 'profile' | 'all';
  sections: number;
  profileId?: string;
  profileName?: string;
}

function collectProfilePayload(profile: Profile): BackupPayload {
  const data: Record<string, unknown> = {};
  for (const rawKey of PROFILE_DATA_KEYS) {
    const raw = localStorage.getItem(profileStorageKey(profile.id, rawKey));
    if (raw !== null) data[rawKey] = safeParse(raw);
  }
  return {
    app: 'nestegg',
    version: PROFILE_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export function collectProfileBackup(profileId: string): BackupPayload | null {
  const profile = getProfile(profileId);
  if (!profile) return null;
  return collectProfilePayload(profile);
}

export function collectAllBackup(): BackupPayload {
  const profiles = readProfilesRaw();
  const activeRaw = localStorage.getItem(STORAGE_KEY_ACTIVE);
  const data: Record<string, unknown> = {};
  for (const key of GLOBAL_DATA_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      data[key] = safeParse(raw);
      continue;
    }
    // Fallback: si el valor compartido aún vive bajo algún perfil (p. ej. el
    // activo sin datos), se toma el primero disponible para no perderlo al
    // exportar la copia completa.
    const owner = [...profiles]
      .sort((a, b) => (b.id === activeRaw ? 1 : 0) - (a.id === activeRaw ? 1 : 0))
      .find(p => localStorage.getItem(profileStorageKey(p.id, key)) !== null);
    if (owner) data[key] = safeParse(localStorage.getItem(profileStorageKey(owner.id, key))!);
  }
  for (const profile of profiles) {
    for (const rawKey of PROFILE_DATA_KEYS) {
      const fullKey = profileStorageKey(profile.id, rawKey);
      const raw = localStorage.getItem(fullKey);
      if (raw !== null) data[fullKey] = safeParse(raw);
    }
  }
  const jointRaw = localStorage.getItem(JOINT_CONFIG_KEY);
  if (jointRaw !== null) data[JOINT_CONFIG_KEY] = safeParse(jointRaw);
  data[STORAGE_KEY_PROFILES] = readProfilesRaw();
  const activeId = localStorage.getItem(STORAGE_KEY_ACTIVE) ?? readProfilesRaw()[0]?.id ?? '';
  data[STORAGE_KEY_ACTIVE] = activeId;
  return {
    app: 'nestegg',
    version: BACKUP_VERSION,
    kind: 'all',
    exportedAt: new Date().toISOString(),
    profiles: readProfilesRaw(),
    data,
  };
}

function ensureProfileExists(profileId: string, name: string): Profile {
  ensureInitialized();
  const existing = getProfile(profileId);
  if (existing) return existing;
  const created = createProfile(name || 'Perfil importado');
  // Reutiliza el id del fichero si es posible para que las referencias de
  // otros datos (si existen) sigan apuntando al mismo perfil.
  if (created.id !== profileId) {
    const profiles = readProfilesRaw();
    const idx = profiles.findIndex(p => p.id === created.id);
    if (idx !== -1) {
      profiles[idx] = { ...profiles[idx], id: profileId };
      localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify(profiles));
      if (localStorage.getItem(STORAGE_KEY_ACTIVE) === created.id) {
        localStorage.setItem(STORAGE_KEY_ACTIVE, profileId);
      }
    }
  }
  return getProfile(profileId)!;
}

export function applyBackup(payload: BackupPayload, targetProfileId?: string): ImportResult | null {
  if (!payload || typeof payload !== 'object' || payload.app !== 'nestegg') return null;
  const data = payload.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  // Perfil de destino forzado: aunque el fichero sea completo, solo se aplica
  // la parte del Agregador al perfil indicado.
  if (typeof targetProfileId === 'string') {
    ensureInitialized();
    ensureProfileExists(targetProfileId, typeof payload.profile?.name === 'string' ? payload.profile.name : 'Perfil importado');
    let sections = 0;
    for (const rawKey of PROFILE_DATA_KEYS) {
      if (rawKey in data) {
        localStorage.setItem(profileStorageKey(targetProfileId, rawKey), JSON.stringify(data[rawKey]));
        sections++;
      }
    }
    const profileName = getProfile(targetProfileId)?.name ?? 'perfil seleccionado';
    return { kind: 'profile', sections, profileId: targetProfileId, profileName };
  }

  // Copia completa (kind 'all'): se restauran perfiles, datos globales y
  // claves planas tal cual.
  if (payload.kind === 'all') {
    let sections = 0;
    for (const [key, value] of Object.entries(data)) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        sections++;
      } catch {}
    }
    ensureInitialized();
    return { kind: 'all', sections };
  }

  // Snapshot completo legacy (v1, sin kind): un fichero plano de localStorage
  // de antes de los perfiles que incluye también claves compartidas/globales
  // (calculadoras, pestaña activa…). Se restaura todo y las claves planas del
  // Agregador se adoptan en el perfil activo.
  const hasGlobalKeys = Object.keys(data).some(k => !(PROFILE_DATA_KEYS as readonly string[]).includes(k));
  if (payload.kind !== 'profile' && hasGlobalKeys) {
    let sections = 0;
    for (const [key, value] of Object.entries(data)) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        sections++;
      } catch {}
    }
    // Asegura un perfil sin disparar las migraciones (que borrarían las claves
    // planas del Agregador si ya existe un valor namespaced).
    const activeId = ensureAnyProfileId();
    for (const rawKey of PROFILE_DATA_KEYS) {
      const legacyRaw = localStorage.getItem(rawKey);
      if (legacyRaw !== null) {
        localStorage.setItem(profileStorageKey(activeId, rawKey), legacyRaw);
        localStorage.removeItem(rawKey);
        sections++;
      }
    }
    ensureInitialized();
    return { kind: 'all', sections };
  }

  // Copia de un único perfil (parcial): solo los datos del Agregador de
  // Finanzas de ese perfil (extractos, precios y depósitos a plazo). Las demás
  // claves del fichero (calculadoras, pestaña activa…) se ignoran.
  // - v2 (kind 'profile'): restaura en el perfil indicado (se crea si falta).
  // - v1 legacy (sin kind): fichero plano de localStorage de un solo perfil;
  //   se restaura en el perfil activo sin tocar el resto de perfiles.
  let profileId: string;
  let profileName: string;
  if (payload.kind === 'profile') {
    profileId = typeof payload.profile?.id === 'string' ? payload.profile.id : randomId();
    profileName = typeof payload.profile?.name === 'string' ? payload.profile.name : 'Perfil importado';
    ensureProfileExists(profileId, profileName);
  } else {
    ensureInitialized();
    profileId = getActiveProfileId();
    profileName = getProfile(profileId)?.name ?? 'perfil activo';
  }
  let sections = 0;
  for (const rawKey of PROFILE_DATA_KEYS) {
    if (rawKey in data) {
      localStorage.setItem(profileStorageKey(profileId, rawKey), JSON.stringify(data[rawKey]));
      sections++;
    }
  }
  return { kind: 'profile', sections, profileId, profileName };
}

/**
 * Restaura de forma autoritativa un fichero de un único perfil: recupera las
 * claves compartidas/globales del documento, escribe el Agregador en el perfil
 * indicado (lo crea o renombra) y elimina el resto de perfiles existentes.
 * Devuelve 'all' porque sustituye por completo el estado de perfiles.
 */
export function restoreSingleProfileAuthoritative(
  payload: BackupPayload,
  profileId: string,
  profileName?: string,
): ImportResult {
  const data = payload.data ?? {};
  ensureInitialized();
  ensureProfileExists(profileId, profileName ?? 'Perfil importado');

  let sections = 0;
  for (const key of GLOBAL_DATA_KEYS) {
    if (key in data) {
      localStorage.setItem(key, JSON.stringify(data[key]));
      sections++;
    }
  }
  for (const rawKey of PROFILE_DATA_KEYS) {
    // Las claves del Agregador pueden venir planas (copia v1) o namespaced
    // bajo el id del perfil del fichero (copia completa de un solo perfil).
    const nsKey = profileStorageKey(profileId, rawKey);
    let value: unknown = undefined;
    if (nsKey in data) value = data[nsKey];
    else if (rawKey in data) value = data[rawKey];
    if (value !== undefined) {
      localStorage.setItem(profileStorageKey(profileId, rawKey), JSON.stringify(value));
      sections++;
    }
  }

  const others = readProfilesRaw().filter(p => p.id !== profileId);
  for (const p of others) {
    for (const rawKey of PROFILE_DATA_KEYS) {
      localStorage.removeItem(profileStorageKey(p.id, rawKey));
    }
  }
  localStorage.removeItem(JOINT_CONFIG_KEY);
  localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify([...readProfilesRaw().filter(p => p.id === profileId)]));
  localStorage.setItem(STORAGE_KEY_ACTIVE, profileId);
  window.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT));

  const finalName = getProfile(profileId)?.name ?? 'perfil restaurado';
  return { kind: 'all', sections, profileId, profileName: finalName };
}

/**
 * Restaura en `toProfileId` (perfil actual) el Agregador de un perfil concreto
 * `fromProfileId` extraído de una copia completa (kind 'all'). No toca las
 * calculadoras compartidas ni el resto de perfiles.
 */
export function applySingleProfileFromAllBackup(
  payload: BackupPayload,
  fromProfileId: string,
  toProfileId: string,
): ImportResult {
  ensureInitialized();
  ensureProfileExists(toProfileId, 'Perfil importado');
  const data = payload.data ?? {};
  let sections = 0;
  for (const rawKey of PROFILE_DATA_KEYS) {
    const nsKey = profileStorageKey(fromProfileId, rawKey);
    if (nsKey in data) {
      localStorage.setItem(profileStorageKey(toProfileId, rawKey), JSON.stringify(data[nsKey]));
      sections++;
    }
  }
  const profileName = getProfile(toProfileId)?.name ?? 'perfil seleccionado';
  return { kind: 'profile', sections, profileId: toProfileId, profileName };
}

// ---------------------------------------------------------------------------
// Hooks de React
// ---------------------------------------------------------------------------

export function useActiveProfileId(): string {
  const [id, setId] = useState<string>(() => getActiveProfileId());
  useEffect(() => {
    const sync = () => setId(getActiveProfileId());
    window.addEventListener(PROFILE_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PROFILE_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return id;
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>(() => getProfiles());
  const activeId = useActiveProfileId();
  const refresh = useProfilesRefresh();

  useEffect(() => {
    const sync = () => setProfiles(getProfiles());
    window.addEventListener(PROFILE_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PROFILE_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const create = (name: string) => {
    const profile = createProfile(name);
    refresh();
    return profile;
  };
  const rename = (id: string, name: string) => {
    const ok = renameProfile(id, name);
    refresh();
    return ok;
  };
  const setColor = (id: string, color: string) => {
    const ok = setProfileColor(id, color);
    refresh();
    return ok;
  };
  const remove = (id: string) => {
    const ok = deleteProfile(id);
    refresh();
    return ok;
  };

  return {
    profiles,
    activeId,
    activeProfile: profiles.find(p => p.id === activeId),
    create,
    rename,
    setColor,
    remove,
    refresh,
  };
}

function useProfilesRefresh() {
  const [, setTick] = useState(0);
  const refresh = () => setTick(t => t + 1);
  return refresh;
}

/**
 * Igual que useLocalStorage pero con la clave namespaced por el perfil activo.
 * Reacciona a los cambios de perfil en caliente: cuando cambia el perfil activo
 * conmuta de forma síncrona a los datos del nuevo perfil para que la interfaz
 * no muestre ni un frame con los datos anteriores ni recargue la página.
 */
export function useProfileLocalStorage<T>(
  rawKey: string,
  initial: T | (() => T),
): [T, (value: T | ((prev: T) => T)) => void, boolean] {
  const activeId = useActiveProfileId();
  const key = profileStorageKey(activeId, rawKey);
  const [stored, setStored] = useState<T>(() => (initial instanceof Function ? initial() : initial));
  const [hydrated, setHydrated] = useState(false);
  const [prevKey, setPrevKey] = useState(key);
  const lastRawRef = useRef<string | null>(null);

  // Cambio de perfil (o de clave): conmuta los datos durante el render para
  // evitar un frame intermedio con los datos del perfil anterior.
  if (typeof window !== 'undefined' && prevKey !== key) {
    setPrevKey(key);
    lastRawRef.current = null;
    let next: T | null = null;
    try {
      const item = localStorage.getItem(key);
      if (item !== null) {
        lastRawRef.current = item;
        next = JSON.parse(item);
      }
    } catch {}
    setStored(next ?? (initial instanceof Function ? initial() : initial));
    setHydrated(true);
  }

  useEffect(() => {
    let active = true;
    const read = () => {
      if (!active) return;
      try {
        const item = localStorage.getItem(key);
        if (item !== null && item !== lastRawRef.current) {
          lastRawRef.current = item;
          setStored(JSON.parse(item));
        }
      } catch {}
      setHydrated(true);
    };
    read();
    window.addEventListener(DATA_CHANGED_EVENT, read);
    return () => {
      active = false;
      window.removeEventListener(DATA_CHANGED_EVENT, read);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setValue = (value: T | ((prev: T) => T)) => {
    setStored(prev => {
      const next = value instanceof Function ? value(prev) : value;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  return [stored, setValue, hydrated];
}