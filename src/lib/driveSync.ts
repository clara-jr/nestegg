import {
  DATA_CHANGED_EVENT,
  PROFILE_CHANGED_EVENT,
  DATA_REVISION_KEY,
  applyBackup,
  ensureInitialized,
  collectAllBackup,
  dispatchDataChanged,
  touchDataRevision,
  type BackupPayload,
} from './profiles';
import { DATA_WRITE_EVENT } from './syncBus';
import {
  createDriveFolder,
  findDriveFolder,
  findSnapshotFile,
  getDriveUser,
  getSnapshotMeta,
  readSnapshotFile,
  writeSnapshotFile,
  ApiError,
  type DriveUser,
} from './driveApi';
import { DRIVE_SYNC_META_KEY, IS_CLIENT_ID_PLACEHOLDER } from './driveConfig';
import {
  DriveAuthError,
  clearSession,
  getAccessToken,
  isClientIdPlaceholder,
  readSession,
  requestAccessToken,
  revokeAccessToken,
} from './driveAuth';

/**
 * Orquestador de la sincronización con Google Drive.
 *
 * Modelo: localStorage es la caché de trabajo (lecturas síncronas) y Drive la
 * copia en la nube. Cada cambio de datos encola un push debounced del snapshot
 * completo (mismo formato que `collectAllBackup`), y toca una revisión
 * (`DATA_REVISION_KEY`) que se guarda dentro del propio snapshot. Al conectar
 * con Drive (al refrescar la página o al iniciar sesión) se compara el
 * contenido local con el remoto vía esa revisión: si coincide no hay nada que
 * hacer (o se sube para alinear la fecha si hay cambios locales pendientes);
 * si difiere de verdad y ambos lados tienen datos reales, se abre un
 * conflicto que resuelve la UI.
 */

export type SyncStatus =
  | { kind: 'logged-out' }
  | { kind: 'connecting' }
  | { kind: 'syncing' }
  | { kind: 'synced'; lastSyncedAt: string }
  | { kind: 'error'; code: 'config' | 'auth' | 'network' | 'read' | 'write' }
  | { kind: 'conflict' };

export interface DriveSyncState {
  status: SyncStatus;
  user: DriveUser | null;
}

interface SyncMeta {
  folderId?: string;
  fileId?: string;
  /** modifiedTime remoto la última vez que sincronizamos. */
  remoteModified?: string;
  /** True si hay cambios locales aún no subidos. */
  dirty: boolean;
}

const DEBOUNCE_MS = 1200;

let state: DriveSyncState = { status: { kind: 'logged-out' }, user: null };
const listeners = new Set<() => void>();
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let applyingRemote = false;
let started = false;
/** Pull inicial (login/start) en curso: los pushes automáticos esperan a que termine. */
let initialPullPromise: Promise<void> | null = null;

function notify(): void {
  listeners.forEach(l => l());
}

function setState(next: DriveSyncState): void {
  state = next;
  notify();
}

// ---------------------------------------------------------------------------
// Meta persistente
// ---------------------------------------------------------------------------

function readMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(DRIVE_SYNC_META_KEY);
    if (!raw) return { dirty: false };
    const parsed = JSON.parse(raw) as Partial<SyncMeta>;
    return {
      dirty: parsed.dirty === true,
      folderId: parsed.folderId,
      fileId: parsed.fileId,
      remoteModified: parsed.remoteModified,
    };
  } catch {
    return { dirty: false };
  }
}

/** Devuelve la carpeta de Drive asociada a la sesión actual, si ya existe. */
export function getSyncFolderId(): string | null {
  return readMeta().folderId ?? null;
}

function writeMeta(meta: SyncMeta): void {
  try {
    localStorage.setItem(DRIVE_SYNC_META_KEY, JSON.stringify(meta));
  } catch {
    // ignorar
  }
}

function clearMeta(): void {
  try {
    localStorage.removeItem(DRIVE_SYNC_META_KEY);
  } catch {
    // ignorar
  }
}

// ---------------------------------------------------------------------------
// Token interactivo
// ---------------------------------------------------------------------------

export { isClientIdPlaceholder };

/** Token válido para operaciones interactivas; si caducó vuelve a pedir login. */
async function interactiveToken(): Promise<string | null> {
  if (IS_CLIENT_ID_PLACEHOLDER) return null;
  try {
    return await getAccessToken();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lógica pura (testeable)
// ---------------------------------------------------------------------------

/** Valida que un objeto sea un snapshot de NestEgg reconocible. */
export function validateSnapshot(payload: unknown): payload is BackupPayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as BackupPayload;
  if (p.app !== 'nestegg') return false;
  return !!p.data && typeof p.data === 'object' && !Array.isArray(p.data);
}

const STRUCTURAL_KEYS = new Set(['nestegg-profiles', 'nestegg-active-profile', 'nestegg-tab', DATA_REVISION_KEY]);

/** True si el estado local tiene algo más que el esqueleto inicial (perfiles vacíos). */
export function hasMeaningfulLocalData(): boolean {
  const payload = collectAllBackup();
  return Object.keys(payload.data ?? {}).some(k => !STRUCTURAL_KEYS.has(k));
}

/** Claves cuyo contenido no es dato de usuario (UI pura o metadatos) y se ignoran al comparar snapshots. */
const SNAPSHOT_IGNORED_KEYS = new Set(['nestegg-tab', DATA_REVISION_KEY]);

/** Ordena las claves de los objetos recursivamente (los arrays conservan el orden) para comparar estructuras. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = canonicalize(record[key]);
    return sorted;
  }
  return value;
}

/** True si dos snapshots contienen exactamente los mismos datos (ignora metadatos y claves de UI). */
export function snapshotsEqual(a: BackupPayload, b: BackupPayload): boolean {
  const dropIgnored = (data: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!SNAPSHOT_IGNORED_KEYS.has(key)) out[key] = value;
    }
    return out;
  };
  const ca = canonicalize(dropIgnored(a.data ?? {}));
  const cb = canonicalize(dropIgnored(b.data ?? {}));
  return JSON.stringify(ca) === JSON.stringify(cb);
}

/**
 * Compara dos snapshots para decidir si representan la misma versión de datos.
 * La revisión de datos (monótona, se toca con cada cambio local incluyendo la
 * pestaña) es una pista rápida: si ambos la conocen y coinciden, son lo mismo.
 * En cuanto falta en alguno de los lados (fichero creado antes de esa función)
 * o ambas difieren (un bump local que no llegó a la nube: cambio de pestaña,
 * escritura idempotente, refetch de precios, recarga dentro del debounce), se
 * decide por el contenido real para no abrir falsos conflictos cuando los
 * datos son idénticos.
 */
export function snapshotsMatch(a: BackupPayload, b: BackupPayload): boolean {
  const aRev = a.data?.[DATA_REVISION_KEY];
  const bRev = b.data?.[DATA_REVISION_KEY];
  const aHas = typeof aRev === 'number';
  const bHas = typeof bRev === 'number';
  if (aHas && bHas && aRev === bRev) return true;
  return snapshotsEqual(a, b);
}

export type SyncDecision =
  | { action: 'idle' }
  | { action: 'push' }
  | { action: 'applyRemote' }
  | { action: 'conflict' };

/**
 * Decide qué hacer al conectar con Drive comparando el contenido real (vía
 * `snapshotsMatch`, que se apoya en la revisión de datos). Se usa igual al
 * refrescar la página que al iniciar sesión: solo se pregunta al usuario
 * cuando el contenido difiere de verdad, nunca por metadatos de Drive.
 */
export function decideSyncAction(args: {
  hasRemote: boolean;
  remoteHasData: boolean;
  localHasData: boolean;
  localDirty: boolean;
  snapshotsMatch: boolean;
}): SyncDecision {
  if (!args.hasRemote) return { action: 'push' };

  if (args.snapshotsMatch) {
    // Mismo contenido: si hubo cambios locales sin subir (aunque idempotentes
    // o de revisión), se sube para alinear la fecha en la nube.
    return args.localDirty ? { action: 'push' } : { action: 'idle' };
  }

  // Contenido distinto: sin datos reales en la nube, se sube el local; si el
  // local está vacío, se carga el remoto; si ambos tienen datos reales
  // distintos, hay que preguntar cómo conciliar.
  if (!args.remoteHasData) return { action: 'push' };
  if (!args.localHasData) return { action: 'applyRemote' };
  return { action: 'conflict' };
}

// ---------------------------------------------------------------------------
// Push y pull
// ---------------------------------------------------------------------------

function isLoggedIn(): boolean {
  return started && readSession() !== null;
}

function toErrorCode(err: unknown): SyncStatus {
  if (err instanceof DriveAuthError) return { kind: 'error', code: 'auth' };
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) return { kind: 'error', code: 'auth' };
    return { kind: 'error', code: 'network' };
  }
  return { kind: 'error', code: 'network' };
}

let reloginInProgress = false;

/** Sesión inválida o caducada: se limpia la sesión y se reabre el flujo de inicio de sesión. */
async function restartLoginFlow(): Promise<void> {
  if (reloginInProgress) return;
  reloginInProgress = true;
  clearSession();
  setState({ status: { kind: 'logged-out' }, user: null });
  try {
    await login();
  } finally {
    reloginInProgress = false;
  }
}

async function applyErrorStatus(status: SyncStatus): Promise<void> {
  if (status.kind === 'error' && status.code === 'auth') {
    await restartLoginFlow();
  } else {
    setState({ ...state, status });
  }
}

/** Localiza (o crea) carpeta y fichero remoto, actualizando la meta. */
async function ensureCloudTarget(token: string): Promise<SyncMeta> {
  const meta = readMeta();
  const folderId = meta.folderId ?? (await findDriveFolder(token)) ?? (await createDriveFolder(token));
  let fileId = meta.fileId ?? null;
  if (!fileId) {
    fileId = (await findSnapshotFile(token, folderId))?.id ?? null;
  }
  const next: SyncMeta = { ...meta, folderId, fileId: fileId ?? undefined };
  writeMeta(next);
  return next;
}

async function pushSnapshot(token: string): Promise<void> {
  setState({ ...state, status: { kind: 'syncing' } });
  ensureInitialized();
  const payload = collectAllBackup();
  const meta = await ensureCloudTarget(token);
  if (!meta.folderId) {
    setState({ ...state, status: { kind: 'error', code: 'write' } });
    return;
  }
  const remote = await writeSnapshotFile(
    token,
    payload,
    meta.fileId
      ? { fileId: meta.fileId, folderId: meta.folderId }
      : { folderId: meta.folderId },
  );
  writeMeta({ ...meta, fileId: remote.id, remoteModified: remote.modifiedTime, dirty: false });
  setState({ ...state, status: { kind: 'synced', lastSyncedAt: new Date().toISOString() } });
}

async function applyRemote(token: string, fileId: string, folderId: string): Promise<void> {
  setState({ ...state, status: { kind: 'syncing' } });
  const payload = await readSnapshotFile(token, fileId);
  if (!payload || !validateSnapshot(payload)) {
    writeMeta({ ...readMeta(), folderId, fileId, dirty: true });
    setState({ ...state, status: { kind: 'error', code: 'read' } });
    return;
  }
  applyingRemote = true;
  try {
    ensureInitialized();
    applyBackup(payload);
    dispatchDataChanged();
  } finally {
    applyingRemote = false;
  }
  const remote = await getSnapshotMeta(token, fileId);
  writeMeta({ ...readMeta(), folderId, fileId, remoteModified: remote.modifiedTime, dirty: false });
  setState({ ...state, status: { kind: 'synced', lastSyncedAt: new Date().toISOString() } });
}

async function pullAndApply(token: string): Promise<void> {
  const meta = await ensureCloudTarget(token);
  const remote = meta.fileId ? await readSnapshotFile(token, meta.fileId) : null;
  const remoteMeta = meta.fileId ? await getSnapshotMeta(token, meta.fileId) : null;
  const persisted = readMeta();
  const remoteHasData = !!remote && Object.keys(remote.data ?? {}).length > 0;

  // Se compara el contenido real (vía la revisión de datos) tanto al refrescar
  // la página como al iniciar sesión: solo se pregunta cómo conciliar cuando
  // los datos de la nube difieren de verdad del estado local.
  ensureInitialized();
  const local = collectAllBackup();
  const matched = !!remote && snapshotsMatch(local, remote);

  const decision = decideSyncAction({
    hasRemote: !!remote,
    remoteHasData,
    localHasData: hasMeaningfulLocalData(),
    localDirty: persisted.dirty,
    snapshotsMatch: matched,
  });

  switch (decision.action) {
    case 'push':
      await pushSnapshot(token);
      break;
    case 'applyRemote':
      if (meta.fileId && meta.folderId) await applyRemote(token, meta.fileId, meta.folderId);
      break;
    case 'conflict':
      setState({ ...state, status: { kind: 'conflict' } });
      break;
    case 'idle':
      writeMeta({
        ...readMeta(),
        folderId: meta.folderId,
        fileId: meta.fileId,
        remoteModified: remoteMeta?.modifiedTime,
        dirty: false,
      });
      setState({ ...state, status: { kind: 'synced', lastSyncedAt: new Date().toISOString() } });
      break;
  }
}

async function handlePushError(err: unknown): Promise<void> {
  if (err instanceof ApiError && err.status === 404) {
    // La carpeta o el fichero fueron borrados fuera de la app: se recrean.
    clearMeta();
    try {
      const token = await interactiveToken();
      if (!token) {
        setState({ status: { kind: 'logged-out' }, user: null });
        return;
      }
      await pushSnapshot(token);
      return;
    } catch (recreateErr) {
      await applyErrorStatus(toErrorCode(recreateErr));
      return;
    }
  }
  await applyErrorStatus(toErrorCode(err));
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export function getSyncState(): DriveSyncState {
  return state;
}

export function subscribeDriveSync(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Marca cambios locales pendientes de subir (a menos que vengan de un pull). */
function markDirty(): void {
  const meta = readMeta();
  if (!meta.dirty) writeMeta({ ...meta, dirty: true });
}

function queuePush(): void {
  if (applyingRemote || !isLoggedIn()) return;
  markDirty();
  if (state.status.kind === 'conflict') return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void (async () => {
      // El push automático espera al pull inicial: si ese pull detecta un
      // conflicto, no hay que sobrescribir Drive antes de que el usuario elija.
      if (initialPullPromise) await initialPullPromise;
      if (state.status.kind === 'conflict') return;
      const token = await interactiveToken();
      if (!token) {
        await restartLoginFlow();
        return;
      }
      try {
        await pushSnapshot(token);
      } catch (err) {
        await handlePushError(err);
      }
    })();
  }, DEBOUNCE_MS);
}

/** Inicia sesión con Google y ejecuta el primer pull (o push inicial). */
export async function login(): Promise<void> {
  if (IS_CLIENT_ID_PLACEHOLDER) {
    setState({ status: { kind: 'error', code: 'config' }, user: null });
    return;
  }
  const pull = (async () => {
    setState({ ...state, status: { kind: 'connecting' } });
    try {
      const token = await requestAccessToken();
      const user = await getDriveUser(token);
      state = { ...state, user };
      notify();
      await pullAndApply(token);
    } catch (err) {
      const status = toErrorCode(err);
      if (status.kind === 'error' && status.code === 'auth') {
        setState({ status: { kind: 'logged-out' }, user: null });
      } else {
        setState({ ...state, status });
      }
    }
  })();
  initialPullPromise = pull;
  try {
    await pull;
  } finally {
    initialPullPromise = null;
  }
}

/** Cierra sesión: revoca el token y mantiene los datos locales intactos. */
export async function logout(): Promise<void> {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  await revokeAccessToken();
  clearMeta();
  setState({ status: { kind: 'logged-out' }, user: null });
}

/** Sincronización manual: sube el estado local a Drive. */
export async function syncNow(): Promise<void> {
  if (!isLoggedIn()) return login();
  const token = await interactiveToken();
  if (!token) {
    await restartLoginFlow();
    return;
  }
  try {
    await pushSnapshot(token);
  } catch (err) {
    await handlePushError(err);
  }
}

/** Resuelve un conflicto: 'remote' carga la versión de Drive; 'local' mantiene la local y sobrescribe. */
export async function resolveConflict(choice: 'remote' | 'local'): Promise<void> {
  const meta = readMeta();
  if (!meta.fileId || !meta.folderId) {
    setState({ status: { kind: 'logged-out' }, user: null });
    return;
  }
  const token = await interactiveToken();
  if (!token) {
    await restartLoginFlow();
    return;
  }
  try {
    if (choice === 'remote') await applyRemote(token, meta.fileId, meta.folderId);
    else await pushSnapshot(token);
  } catch (err) {
    setState({ ...state, status: toErrorCode(err) });
  }
}

/** Restaura la sesión persistida (si existe) y dispara el pull inicial. */
export async function start(): Promise<void> {
  if (started) return;
  started = true;
  if (IS_CLIENT_ID_PLACEHOLDER) {
    setState({ status: { kind: 'logged-out' }, user: null });
    return;
  }
  const session = readSession();
  if (!session) {
    setState({ status: { kind: 'logged-out' }, user: null });
    return;
  }
  const pull = (async () => {
    setState({ ...state, status: { kind: 'connecting' } });
    try {
      const user = await getDriveUser(session.accessToken);
      state = { ...state, user };
      notify();
      await pullAndApply(session.accessToken);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        // El token ya no es válido: sesión caducada. Restaurar el flujo de login.
        await restartLoginFlow();
      } else {
        await applyErrorStatus(toErrorCode(err));
      }
    }
  })();
  initialPullPromise = pull;
  try {
    await pull;
  } finally {
    initialPullPromise = null;
  }
}

// ---------------------------------------------------------------------------
// Escucha de cambios de datos (registro al importar el módulo)
// ---------------------------------------------------------------------------

function initListeners(): void {
  if (typeof window === 'undefined') return;
  const onDataChanged = () => {
    // Al aplicar un remoto, la revisión se restaura desde el fichero; no la pisamos.
    if (!applyingRemote) touchDataRevision();
    queuePush();
  };
  window.addEventListener(DATA_CHANGED_EVENT, onDataChanged);
  window.addEventListener(PROFILE_CHANGED_EVENT, onDataChanged);
  window.addEventListener(DATA_WRITE_EVENT, onDataChanged);
}

initListeners();