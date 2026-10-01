/**
 * Configuración de la sincronización con Google Drive.
 *
 * La app es un sitio estático: la autenticación y las llamadas a la API se
 * hacen desde el navegador. Se usa Google Identity Services (GIS) para obtener
 * un Access Token con el scope de Drive y la API REST de Drive v3 para leer y
 * escribir el snapshot de datos (mismo formato que las copias de seguridad).
 *
 * Configuración en Google Cloud Console (requerida antes de usar el login):
 *  1. Crear un proyecto y habilitar la API de Google Drive.
 *  2. Crear un OAuth 2.0 Client ID de tipo «Web application».
 *  3. Añadir como «Authorized JavaScript origins»:
 *       - https://clara-jr.github.io   (producción)
 *       - http://localhost:4321        (desarrollo)
 *  4. Sustituir FALLBACK_CLIENT_ID por tu Client ID real, o exportar
 *     PUBLIC_GOOGLE_CLIENT_ID en el build. La app tratará como pendiente de
 *     configuración únicamente el valor PLACEHOLDER_CLIENT_ID.
 *
 * PUBLIC_GOOGLE_CLIENT_ID es una variable de entorno pública de build: Astro
 * la expone en `import.meta.env` y queda embebida en el bundle del cliente.
 */

/** Valor que indica que el Client ID real aún no se ha configurado. */
const PLACEHOLDER_CLIENT_ID = 'PENDIENTE-google-client-id.apps.googleusercontent.com';

export const GOOGLE_CLIENT_ID: string =
  (import.meta.env.PUBLIC_GOOGLE_CLIENT_ID as string | undefined)?.trim() || PLACEHOLDER_CLIENT_ID;

/** True mientras el Client ID no haya sido sustituido por el real. */
export const IS_CLIENT_ID_PLACEHOLDER: boolean =
  !GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === PLACEHOLDER_CLIENT_ID;

/** Scope de Drive: acceso solo a los archivos creados por esta app. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Carpeta visible en Drive donde se guarda el snapshot. */
export const DRIVE_FOLDER_NAME = 'NestEgg';
/** Nombre del fichero de sincronización dentro de la carpeta. */
export const DRIVE_FILE_NAME = 'nestegg-backup.json';

export const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';

/** Clave con la sesión de token persistida en localStorage. */
export const DRIVE_SESSION_KEY = 'nestegg-drive-session';
/** Metadatos de sincronización persistentes. */
export const DRIVE_SYNC_META_KEY = 'nestegg-drive-sync';