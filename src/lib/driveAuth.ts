import {
  DRIVE_SCOPE,
  DRIVE_SESSION_KEY,
  GIS_SCRIPT_URL,
  GOOGLE_CLIENT_ID,
  IS_CLIENT_ID_PLACEHOLDER,
} from './driveConfig';

/**
 * Autenticación con Google Identity Services (GIS).
 *
 * Se obtiene un Access Token con el scope de Drive mediante
 * `google.accounts.oauth2.initTokenClient`. La sesión se persiste en
 * localStorage con su fecha de expiración para restaurarla al recargar.
 */

export interface DriveSession {
  accessToken: string;
  /** Época en milisegundos en la que expira el token. */
  expiresAt: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GsiError {
  type?: string;
  message?: string;
  error?: string;
}

export interface TokenClient {
  requestAccessToken: () => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            prompt?: string;
            callback: (resp: TokenResponse) => void;
            error_callback?: (err: GsiError) => void;
          }) => TokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** True si aún no se ha sustituido el Client ID por el real. */
export function isClientIdPlaceholder(): boolean {
  return IS_CLIENT_ID_PLACEHOLDER;
}

function isGsiLoaded(): boolean {
  return typeof window !== 'undefined' && !!window.google?.accounts?.oauth2;
}

/** Carga el script de GIS de forma asíncrona (una sola vez). */
export function loadGsiScript(): Promise<void> {
  if (isGsiLoaded()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar Google Identity Services'));
    document.head.appendChild(script);
  });
}

export function readSession(): DriveSession | null {
  try {
    const raw = localStorage.getItem(DRIVE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DriveSession;
    if (typeof parsed.accessToken !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    if (parsed.expiresAt - TOKEN_REFRESH_MARGIN_MS < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(session: DriveSession): void {
  try {
    localStorage.setItem(DRIVE_SESSION_KEY, JSON.stringify(session));
  } catch {
    // sin persistencia: la sesión dura lo que dure la pestaña
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(DRIVE_SESSION_KEY);
  } catch {
    // ignorar
  }
}

export class DriveAuthError extends Error {}

/** Pide un token al usuario (selector de cuenta). Resuelve con el token. */
export async function requestAccessToken(): Promise<string> {
  await loadGsiScript();
  const existing = readSession();
  if (existing) return existing.accessToken;
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const oauth = window.google?.accounts?.oauth2;
    if (!oauth) {
      reject(new DriveAuthError('GIS no está disponible'));
      return;
    }
    const client = oauth.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: response => {
        if (response.error || !response.access_token) {
          if (!settled) {
            settled = true;
            reject(new DriveAuthError(response.error_description || response.error || 'Error de autenticación'));
          }
          return;
        }
        const session = { accessToken: response.access_token, expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 };
        writeSession(session);
        settled = true;
        resolve(session.accessToken);
      },
      error_callback: err => {
        if (!settled) {
          settled = true;
          reject(new DriveAuthError(err?.message || err?.error || 'Error de autenticación'));
        }
      },
    });
    client.requestAccessToken();
  });
}

/** Obtiene un token válido, refrescándolo en silencio si hace falta. */
export async function getAccessToken(): Promise<string> {
  const existing = readSession();
  if (existing) return existing.accessToken;
  return requestAccessToken();
}

/** Revoca el token actual (logout) y limpia la sesión persistida. */
export async function revokeAccessToken(): Promise<void> {
  const token = readSession()?.accessToken;
  clearSession();
  if (!token) return;
  await loadGsiScript();
  const oauth = window.google?.accounts?.oauth2;
  if (oauth) {
    await new Promise<void>(resolve => oauth.revoke(token, () => resolve()));
  }
}