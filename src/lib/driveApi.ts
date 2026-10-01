import {
  DRIVE_API_BASE,
  DRIVE_FILE_NAME,
  DRIVE_FOLDER_NAME,
  DRIVE_UPLOAD_BASE,
} from './driveConfig';
import type { BackupPayload } from './profiles';

/**
 * Capa de acceso a la API REST de Google Drive v3 desde el navegador.
 *
 * Todas las funciones reciben el token y son asíncronas y puras (sin estado),
 * lo que permite testearlas con `fetch` mockeado. El flujo (login, refresco,
 * conflictos) lo orquesta driveSync.
 */

export interface DriveFileRef {
  id: string;
  modifiedTime?: string;
  name?: string;
}

export interface DriveUser {
  displayName?: string;
  emailAddress?: string;
  photoLink?: string;
}

function params(query: Record<string, string | undefined>): string {
  const pairs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`);
  return pairs.length ? `?${pairs.join('&')}` : '';
}

interface ApiInit extends RequestInit {
  token: string;
}

async function apiFetch(path: string, init: ApiInit): Promise<Response> {
  const { token, ...rest } = init;
  return fetch(`${DRIVE_API_BASE}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(rest.headers ?? {}),
    },
  });
}

interface ListResult {
  files?: Array<{ id?: string; name?: string; modifiedTime?: string }>;
}

/** Busca la carpeta de la app. Devuelve su id o null si no existe (scope drive.file: solo ve lo que crea la app). */
export async function findDriveFolder(token: string): Promise<string | null> {
  const q = `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await apiFetch(`/files${params({ q, fields: 'files(id,name)', spaces: 'drive' })}`, { token });
  if (!res.ok) throw new ApiError(res, 'No se pudo buscar la carpeta');
  const json = (await res.json()) as ListResult;
  return json.files?.[0]?.id ?? null;
}

/** Crea la carpeta de la app en Drive. Devuelve su id. */
export async function createDriveFolder(token: string): Promise<string> {
  const res = await apiFetch(`/files${params({ fields: 'id' })}`, {
    token,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!res.ok) throw new ApiError(res, 'No se pudo crear la carpeta');
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new ApiError(res, 'La carpeta no devolvió id');
  return json.id;
}

const SNAPSHOT_MIME = 'application/json';

/** Busca el fichero de snapshot dentro de la carpeta (o en todo Drive visible). */
export async function findSnapshotFile(token: string, folderId?: string): Promise<DriveFileRef | null> {
  let q = `name='${DRIVE_FILE_NAME}' and trashed=false`;
  if (folderId) q += ` and '${folderId}' in parents`;
  const res = await apiFetch(`/files${params({ q, fields: 'files(id,name,modifiedTime)', spaces: 'drive' })}`, { token });
  if (!res.ok) throw new ApiError(res, 'No se pudo buscar el fichero de sincronización');
  const json = (await res.json()) as ListResult;
  const file = json.files?.[0];
  return file?.id ? { id: file.id, name: file.name, modifiedTime: file.modifiedTime } : null;
}

function buildMultipartBody(metadata: unknown, content: string): { blob: Blob; contentType: string } {
  const boundary = `nestegg_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`;
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [
    encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    JSON.stringify(metadata),
    encoder.encode(`\r\n--${boundary}\r\nContent-Type: ${SNAPSHOT_MIME}; charset=UTF-8\r\n\r\n`),
    content,
    encoder.encode(`\r\n--${boundary}--\r\n`),
  ];
  return { blob: new Blob(parts, { type: `multipart/related; boundary=${boundary}` }), contentType: `multipart/related; boundary=${boundary}` };
}

/**
 * Crea o actualiza el fichero de snapshot. Si se pasa `fileId` actualiza ese
 * fichero; si no, crea uno nuevo dentro de `folderId`. Devuelve el fichero
 * resultante (id + modifiedTime).
 */
export async function writeSnapshotFile(
  token: string,
  payload: BackupPayload,
  opts: { fileId?: string; folderId?: string },
): Promise<DriveFileRef> {
  const metadata: Record<string, unknown> = { name: DRIVE_FILE_NAME };
  if (!opts.fileId && opts.folderId) metadata.parents = [opts.folderId];
  const { blob, contentType } = buildMultipartBody(metadata, JSON.stringify(payload));

  const url = opts.fileId
    ? `${DRIVE_UPLOAD_BASE}/files/${opts.fileId}${params({ uploadType: 'multipart' })}`
    : `${DRIVE_UPLOAD_BASE}/files${params({ uploadType: 'multipart' })}`;
  const res = await fetch(url, {
    method: opts.fileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body: blob,
  });
  if (!res.ok) throw new ApiError(res, 'No se pudo subir el fichero de sincronización');
  const json = (await res.json()) as DriveFileRef;
  if (!json.id) throw new ApiError(res, 'El fichero no devolvió id');
  return { id: json.id, name: json.name, modifiedTime: json.modifiedTime };
}

/** Lee el contenido del snapshot y lo devuelve como objeto o null si no es JSON válido. */
export async function readSnapshotFile(token: string, fileId: string): Promise<BackupPayload | null> {
  const res = await apiFetch(`/files/${fileId}${params({ alt: 'media' })}`, { token });
  if (!res.ok) throw new ApiError(res, 'No se pudo leer el fichero de sincronización');
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as BackupPayload;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Metadatos del fichero (modifiedTime para detectar conflictos). */
export async function getSnapshotMeta(token: string, fileId: string): Promise<DriveFileRef> {
  const res = await apiFetch(`/files/${fileId}${params({ fields: 'id,name,modifiedTime' })}`, { token });
  if (!res.ok) throw new ApiError(res, 'No se pudo obtener los metadatos del fichero');
  const json = (await res.json()) as DriveFileRef;
  return json;
}

/** Información del usuario autenticado para mostrarla en la interfaz. */
export async function getDriveUser(token: string): Promise<DriveUser> {
  const res = await apiFetch(`/about${params({ fields: 'user(displayName,emailAddress,photoLink)' })}`, { token });
  if (!res.ok) throw new ApiError(res, 'No se pudo obtener la cuenta');
  const json = (await res.json()) as { user?: DriveUser };
  return json.user ?? {};
}

export class ApiError extends Error {
  status: number;
  constructor(res: Response, message: string) {
    super(`${message} (HTTP ${res.status})`);
    this.name = 'ApiError';
    this.status = res.status;
  }
}