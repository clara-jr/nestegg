// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  hasMeaningfulLocalData,
  validateSnapshot,
  decideSyncAction,
  snapshotsEqual,
  snapshotsMatch,
} from '../driveSync';
import {
  findDriveFolder,
  findSnapshotFile,
  writeSnapshotFile,
  readSnapshotFile,
  createDriveFolder,
} from '../driveApi';
import type { BackupPayload } from '../profiles';

function okJson(json: unknown) {
  return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) };
}

function okText(text: string) {
  return { ok: true, status: 200, json: async () => ({}), text: async () => text };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('validateSnapshot', () => {
  it('acepta un snapshot de NestEgg', () => {
    expect(validateSnapshot({ app: 'nestegg', data: { 'savings-params': {} } })).toBe(true);
  });

  it('rechaza objetos que no son de NestEgg', () => {
    expect(validateSnapshot(null)).toBe(false);
    expect(validateSnapshot(undefined)).toBe(false);
    expect(validateSnapshot('texto')).toBe(false);
    expect(validateSnapshot({ app: 'otra-app', data: {} })).toBe(false);
    expect(validateSnapshot({ app: 'nestegg' })).toBe(false);
    expect(validateSnapshot({ app: 'nestegg', data: [] })).toBe(false);
  });
});

describe('hasMeaningfulLocalData', () => {
  it('devuelve false con un almacenamiento vacío (solo esqueleto inicial)', () => {
    expect(hasMeaningfulLocalData()).toBe(false);
  });

  it('devuelve true cuando hay parámetros de calculadora guardados', () => {
    localStorage.setItem('savings-params', JSON.stringify({ cushion: 100 }));
    expect(hasMeaningfulLocalData()).toBe(true);
  });
});

describe('snapshotsEqual', () => {
  const base: BackupPayload = {
    app: 'nestegg',
    version: 2,
    exportedAt: '2026-01-01T00:00:00.000Z',
    data: {
      'savings-params': { cushion: 100, taxRate: 0.19 },
      profile: { bar: [1, 2, 3] },
    },
  };

  it('considera iguales snapshots con los mismos datos en distinto orden de claves', () => {
    const other: BackupPayload = {
      ...base,
      exportedAt: '2026-01-02T00:00:00.000Z',
      data: {
        profile: { bar: [1, 2, 3] },
        'savings-params': { taxRate: 0.19, cushion: 100 },
      },
    };
    expect(snapshotsEqual(base, other)).toBe(true);
  });

  it('ignora metadatos de exportación (exportedAt, version) al comparar', () => {
    const other: BackupPayload = {
      ...base,
      version: 1,
      exportedAt: '2026-05-05T00:00:00.000Z',
    };
    expect(snapshotsEqual(base, other)).toBe(true);
  });

  it('ignora la pestaña activa (nestegg-tab) por ser solo estado de UI', () => {
    const other: BackupPayload = {
      ...base,
      data: { ...base.data, 'nestegg-tab': 'retirement' },
    };
    expect(snapshotsEqual(base, other)).toBe(true);
  });

  it('considera distintos snapshots con un parámetro de calculadora diferente', () => {
    const other: BackupPayload = {
      ...base,
      data: { ...base.data, 'savings-params': { cushion: 500, taxRate: 0.19 } },
    };
    expect(snapshotsEqual(base, other)).toBe(false);
  });

  it('considera distintos snapshots cuando uno tiene claves adicionales', () => {
    const other: BackupPayload = {
      ...base,
      data: { ...base.data, 'retirement-params': { age: 65 } },
    };
    expect(snapshotsEqual(base, other)).toBe(false);
  });

  it('considera distintos snapshots con arrays en distinto orden', () => {
    const other: BackupPayload = {
      ...base,
      data: { ...base.data, profile: { bar: [1, 3, 2] } },
    };
    expect(snapshotsEqual(base, other)).toBe(false);
  });
});

describe('snapshotsMatch', () => {
  const withRev = (rev: number, extra: Record<string, unknown> = {}) => ({
    app: 'nestegg' as const,
    version: 2,
    exportedAt: '2026-01-01T00:00:00.000Z',
    data: { 'savings-params': { cushion: 100 }, 'nestegg-data-rev': rev, ...extra },
  });

  it('a igual revisión considera los snapshots iguales aunque la pestaña difiera', () => {
    expect(
      snapshotsMatch(withRev(5), withRev(5, { 'nestegg-tab': 'investments' }) as BackupPayload),
    ).toBe(true);
  });

  it('a distinta revisión pero con el mismo contenido considera los snapshots iguales', () => {
    expect(snapshotsMatch(withRev(5), withRev(6) as BackupPayload)).toBe(true);
  });

  it('a distinta revisión y contenido distinto considera los snapshots distintos', () => {
    const b = withRev(6, { savings: { cushion: 500 } });
    expect(snapshotsMatch(withRev(5) as BackupPayload, b as BackupPayload)).toBe(false);
  });

  it('sin revisión en al menos uno de los dos falla a comparar por contenido', () => {
    const remote: BackupPayload = {
      app: 'nestegg',
      version: 2,
      exportedAt: '2026-01-01T00:00:00.000Z',
      data: { 'savings-params': { cushion: 100 } },
    };
    expect(snapshotsMatch(withRev(5) as BackupPayload, remote)).toBe(true);
    const changed: BackupPayload = {
      ...remote,
      data: { 'savings-params': { cushion: 500 } },
    };
    expect(snapshotsMatch(withRev(5) as BackupPayload, changed)).toBe(false);
  });

  it('si ambos carecen de revisión compara el contenido completo', () => {
    const a: BackupPayload = {
      app: 'nestegg',
      version: 2,
      exportedAt: '2026-01-01T00:00:00.000Z',
      data: { 'savings-params': { cushion: 100 } },
    };
    const b: BackupPayload = {
      ...a,
      data: { 'savings-params': { cushion: 100 }, 'nestegg-tab': 'retirement' },
    };
    expect(snapshotsMatch(a, b)).toBe(true);
  });
});

describe('decideSyncAction', () => {
  const base = {
    localDirty: false,
    localHasData: true,
    remoteHasData: true,
    hasRemote: true,
    snapshotsMatch: false,
  };

  it('sube el estado local si no existe fichero remoto', () => {
    expect(decideSyncAction({ ...base, hasRemote: false })).toEqual({ action: 'push' });
  });

  it('no hace nada si el contenido coincide y no hay cambios locales pendientes', () => {
    expect(decideSyncAction({ ...base, snapshotsMatch: true, localDirty: false })).toEqual({
      action: 'idle',
    });
  });

  it('sube el local si el contenido coincide pero hay cambios locales pendientes (alinea la fecha)', () => {
    expect(decideSyncAction({ ...base, snapshotsMatch: true, localDirty: true })).toEqual({
      action: 'push',
    });
  });

  it('aplica el remoto cuando el contenido difiere y el local está vacío', () => {
    expect(decideSyncAction({ ...base, snapshotsMatch: false, localHasData: false })).toEqual({
      action: 'applyRemote',
    });
  });

  it('sube el local cuando el contenido difiere pero la nube no tiene datos reales', () => {
    expect(decideSyncAction({ ...base, snapshotsMatch: false, remoteHasData: false })).toEqual({
      action: 'push',
    });
  });

  it('declara conflicto cuando el contenido difiere y ambos lados tienen datos reales', () => {
    expect(decideSyncAction({ ...base, snapshotsMatch: false })).toEqual({ action: 'conflict' });
  });
});

describe('driveApi (fetch mockeado)', () => {
  it('busca la carpeta con el nombre y tipo correctos', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ files: [{ id: 'folder-1' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const id = await findDriveFolder('token');
    expect(id).toBe('folder-1');

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.origin).toBe('https://www.googleapis.com');
    expect(url.pathname).toBe('/drive/v3/files');
    const q = url.searchParams.get('q');
    expect(q).toContain("name='NestEgg'");
    expect(q).toContain("mimeType='application/vnd.google-apps.folder'");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token');

    vi.unstubAllGlobals();
  });

  it('crea la carpeta por POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ id: 'folder-new' }));
    vi.stubGlobal('fetch', fetchMock);

    const id = await createDriveFolder('token');
    expect(id).toBe('folder-new');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');

    vi.unstubAllGlobals();
  });

  it('busca el fichero de snapshot dentro de la carpeta', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ files: [{ id: 'file-1', modifiedTime: 't1' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const file = await findSnapshotFile('token', 'folder-1');
    expect(file?.id).toBe('file-1');
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    const q = url.searchParams.get('q');
    expect(q).toContain("name='nestegg-backup.json'");
    expect(q).toContain("'folder-1' in parents");

    vi.unstubAllGlobals();
  });

  it('crea el fichero por POST y lo actualiza por PATCH en la URL de upload', async () => {
    const payload: BackupPayload = {
      app: 'nestegg',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      data: { x: 1 },
    };
    const ok = { ok: true, status: 200, json: async () => ({ id: 'file-1' }), text: async () => '' };
    const fetchMock = vi.fn().mockResolvedValue(ok);
    vi.stubGlobal('fetch', fetchMock);

    await writeSnapshotFile('token', payload, { folderId: 'folder-1' });
    const createCall = fetchMock.mock.calls[0];
    expect(createCall[1].method).toBe('POST');
    expect((createCall[0] as string)).toContain('upload/drive/v3/files');

    await writeSnapshotFile('token', payload, { fileId: 'file-1', folderId: 'folder-1' });
    const updateCall = fetchMock.mock.calls[1];
    expect(updateCall[1].method).toBe('PATCH');
    expect(updateCall[0] as string).toContain('upload/drive/v3/files/file-1');
    expect(updateCall[1].body).toBeInstanceOf(Blob);
    expect((updateCall[1].headers['Content-Type'] as string)).toContain('multipart/related');

    vi.unstubAllGlobals();
  });

  it('devuelve el fichero creado/actualizado con su id y modifiedTime', async () => {
    const payload = {
      app: 'nestegg' as const,
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      data: { x: 1 },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okJson({ id: 'file-2', name: 'nestegg-backup.json', modifiedTime: '2026-01-02T00:00:00Z' })),
    );

    const created = await writeSnapshotFile('token', payload, { folderId: 'folder-1' });
    expect(created.id).toBe('file-2');
    expect(created.modifiedTime).toBe('2026-01-02T00:00:00Z');

    vi.unstubAllGlobals();
  });

  it('lee y parsea el contenido del snapshot', async () => {
    const body = JSON.stringify({ app: 'nestegg', data: { 'savings-params': { cushion: 5 } } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okText(body)));

    const snapshot = await readSnapshotFile('token', 'file-1');
    expect(snapshot?.app).toBe('nestegg');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okText('no es json')));
    expect(await readSnapshotFile('token', 'file-1')).toBeNull();

    vi.unstubAllGlobals();
  });
});