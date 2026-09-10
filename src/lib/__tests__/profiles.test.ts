// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PROFILE_DATA_KEYS,
  STORAGE_KEY_ACTIVE,
  STORAGE_KEY_PROFILES,
  applyBackup,
  applySingleProfileFromAllBackup,
  collectAllBackup,
  collectProfileBackup,
  createProfile,
  deleteProfile,
  ensureInitialized,
  getActiveProfileId,
  getJointConfig,
  getProfile,
  getProfileData,
  getProfiles,
  profileStorageKey,
  renameProfile,
  restoreSingleProfileAuthoritative,
  saveJointConfig,
  setActiveProfileId,
  setProfileData,
} from '../profiles';

describe('profileStorageKey', () => {
  it('namespaces raw keys under a profile', () => {
    expect(profileStorageKey('abc', 'nestegg-investments-v1')).toBe('nestegg:p:abc:nestegg-investments-v1');
  });
});

describe('ensureInitialized', () => {
  beforeEach(() => localStorage.clear());

  it('creates a default profile when the store is empty', () => {
    const active = ensureInitialized();
    const profiles = getProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe('Mi perfil');
    expect(active).toBe(profiles[0].id);
  });

  it('migrates legacy root Agregador keys into the default profile', () => {
    localStorage.setItem('nestegg-investments-v1', JSON.stringify({ files: [], movements: [] }));
    localStorage.setItem('savings-params', JSON.stringify({ cushion: 1 }));
    const active = ensureInitialized();
    expect(localStorage.getItem(profileStorageKey(active, 'nestegg-investments-v1'))).not.toBeNull();
    expect(localStorage.getItem('nestegg-investments-v1')).toBeNull();
    // Los parámetros de las calculadoras son compartidos: se quedan en la raíz.
    expect(localStorage.getItem('savings-params')).toEqual(JSON.stringify({ cushion: 1 }));
    expect(localStorage.getItem(profileStorageKey(active, 'savings-params'))).toBeNull();
  });

  it('promotes the active profile calculator params to the shared root and cleans per-profile leftovers', () => {
    ensureInitialized();
    const active = getActiveProfileId();
    setProfileData(active, 'savings-params', { cushion: 9000 });
    const other = createProfile('Otra');
    setProfileData(other.id, 'savings-params', { cushion: 111 });
    ensureInitialized();
    expect(JSON.parse(localStorage.getItem('savings-params')!)).toEqual({ cushion: 9000 });
    expect(localStorage.getItem(profileStorageKey(active, 'savings-params'))).toBeNull();
    expect(localStorage.getItem(profileStorageKey(other.id, 'savings-params'))).toBeNull();
  });

  it('recovers shared calculator values from another profile when the active one has none', () => {
    ensureInitialized();
    const active = getActiveProfileId();
    const other = createProfile('Otra');
    setProfileData(other.id, 'savings-params', { cushion: 555 });
    ensureInitialized();
    expect(JSON.parse(localStorage.getItem('savings-params')!)).toEqual({ cushion: 555 });
    expect(active).not.toBe(other.id);
    expect(localStorage.getItem(profileStorageKey(other.id, 'savings-params'))).toBeNull();
  });

  it('includes shared calculator values in a full backup even if they still live under a profile', () => {
    localStorage.clear();
    const p = { id: 'p1', name: 'Mi perfil', color: '#0f766e', createdAt: '2026-01-01' };
    localStorage.setItem(STORAGE_KEY_PROFILES, JSON.stringify([p]));
    localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(p.id));
    localStorage.setItem(profileStorageKey(p.id, 'savings-params'), JSON.stringify({ cushion: 999 }));
    const backup = collectAllBackup();
    expect(backup.data['savings-params']).toEqual({ cushion: 999 });
  });
    it('keeps an existing shared calculator value when migrating', () => {
    ensureInitialized();
    const active = getActiveProfileId();
    localStorage.setItem('savings-params', JSON.stringify({ cushion: 42 }));
    setProfileData(active, 'savings-params', { cushion: 9000 });
    ensureInitialized();
    expect(JSON.parse(localStorage.getItem('savings-params')!)).toEqual({ cushion: 42 });
    expect(localStorage.getItem(profileStorageKey(active, 'savings-params'))).toBeNull();
  });

  it('migrates stray root investment keys into the active profile when profiles exist', () => {
    const active = ensureInitialized();
    localStorage.setItem('nestegg-prices-v1', JSON.stringify({ VWCE: { value: 100, source: 'auto' } }));
    ensureInitialized();
    expect(localStorage.getItem('nestegg-prices-v1')).toBeNull();
    expect(getProfileData(active, 'nestegg-prices-v1')).toEqual({ VWCE: { value: 100, source: 'auto' } });
  });

  it('does not overwrite existing profiles', () => {
    ensureInitialized();
    localStorage.setItem('nestegg-prices-v1', JSON.stringify({ x: 1 }));
    const active = ensureInitialized();
    expect(getProfiles()).toHaveLength(1);
    expect(getProfileData(active, 'nestegg-prices-v1')).toEqual({ x: 1 });
  });
});

describe('profile CRUD', () => {
  beforeEach(() => localStorage.clear());

  it('creates, renames and deletes a profile', () => {
    ensureInitialized();
    const p = createProfile('Laura');
    const preDelete = getProfile(p.id)!;
    expect(preDelete.name).toBe('Laura');
    expect(renameProfile(p.id, 'Laura G.')).toBe(true);
    expect(getProfile(p.id)?.name).toBe('Laura G.');
    expect(deleteProfile(p.id)).toBe(true);
    expect(getProfile(p.id)).toBeUndefined();
  });

  it('cleans up namespaced keys when deleting a profile', () => {
    ensureInitialized();
    const p = createProfile('Alex');
    setProfileData(p.id, 'nestegg-investments-v1', { files: [], movements: [] });
    deleteProfile(p.id);
    expect(localStorage.getItem(profileStorageKey(p.id, 'nestegg-investments-v1'))).toBeNull();
  });

  it('does not remove shared calculator keys when deleting a profile', () => {
    ensureInitialized();
    const p = createProfile('Alex');
    localStorage.setItem('savings-params', JSON.stringify({ cushion: 1 }));
    deleteProfile(p.id);
    expect(localStorage.getItem('savings-params')).toEqual(JSON.stringify({ cushion: 1 }));
  });

  it('reassigns the active profile when deleting the active one', () => {
    ensureInitialized();
    const first = getActiveId();
    const second = createProfile('Alex');
    setActiveProfileId(second.id);
    deleteProfile(second.id);
    expect(getActiveId()).toBe(first as string);
  });
});

describe('active profile', () => {
  beforeEach(() => localStorage.clear());

  it('persists and returns the active profile', () => {
    const p1 = createProfile('A');
    const p2 = createProfile('B');
    setActiveProfileId(p2.id);
    expect(getActiveId()).toBe(p2.id);
    setActiveProfileId(p1.id);
    expect(getActiveId()).toBe(p1.id);
  });
});

describe('backup and restore', () => {
  beforeEach(() => localStorage.clear());

  it('downloads a partial localStorage copy (Agregador only) and restores it into the active profile', () => {
    ensureInitialized();
    const activeId = getActiveProfileId();
    setProfileData(activeId, 'nestegg-investments-v1', { files: [], movements: [{ id: 'm1' }] });
    setProfileData(activeId, 'nestegg-prices-v1', { VWCE: { value: 100 } });
    setProfileData(activeId, 'savings-params', { cushion: 5000 });
    const backup = collectProfileBackup(activeId)!;
    expect(backup.version).toBe(1);
    expect(backup.kind).toBeUndefined();
    expect(backup.profile).toBeUndefined();
    expect(backup.data['nestegg-investments-v1']).toEqual({ files: [], movements: [{ id: 'm1' }] });
    expect(backup.data['nestegg-prices-v1']).toEqual({ VWCE: { value: 100 } });
    // La copia de un perfil solo incluye la parte del Agregador.
    expect(backup.data['savings-params']).toBeUndefined();

    localStorage.removeItem(profileStorageKey(activeId, 'nestegg-investments-v1'));
    const result = applyBackup(backup)!;
    expect(result.kind).toBe('profile');
    expect(getProfileData(activeId, 'nestegg-investments-v1')).toEqual({ files: [], movements: [{ id: 'm1' }] });
    expect(getProfileData(activeId, 'nestegg-prices-v1')).toEqual({ VWCE: { value: 100 } });
  });

  it('treats a v1 legacy snapshot that carries shared keys as a full restore', () => {
    ensureInitialized();
    const activeId = getActiveProfileId();
    const other = createProfile('Otra');
    setProfileData(activeId, 'nestegg-investments-v1', { files: [], movements: [{ id: 'viejo' }] });
    setProfileData(other.id, 'nestegg-investments-v1', { files: [], movements: [{ id: 'otro' }] });

    const legacy = {
      app: 'nestegg',
      version: 1,
      exportedAt: '2026-09-01T21:38:18.399Z',
      data: {
        'savings-params': { cushion: 5000 },
        'nestegg-investments-v1': { files: [], movements: [{ id: 'legacy-1' }] },
        'nestegg-prices-v1': { VWCE: { value: 100, source: 'auto' } },
        'nestegg-tab': 'portfolio',
      },
    };
    const result = applyBackup(legacy as never)!;
    expect(result.kind).toBe('all');
    // Las claves compartidas y globales del fichero se restauran.
    expect(localStorage.getItem('savings-params')).toEqual(JSON.stringify({ cushion: 5000 }));
    expect(localStorage.getItem('nestegg-tab')).toEqual(JSON.stringify('portfolio'));
    // Las claves planas del Agregador se adoptan en el perfil activo.
    expect(getProfileData(activeId, 'nestegg-investments-v1')).toEqual({ files: [], movements: [{ id: 'legacy-1' }] });
    expect(getProfileData(activeId, 'nestegg-prices-v1')).toEqual({ VWCE: { value: 100, source: 'auto' } });
    // El otro perfil queda intacto.
    expect(getProfileData(other.id, 'nestegg-investments-v1')).toEqual({ files: [], movements: [{ id: 'otro' }] });
  });

  it('restores a v1 partial copy (Agregador only) into the active profile', () => {
    ensureInitialized();
    const activeId = getActiveProfileId();
    const other = createProfile('Otra');
    setProfileData(activeId, 'nestegg-investments-v1', { files: [], movements: [{ id: 'viejo' }] });

    const partial = {
      app: 'nestegg',
      version: 1,
      exportedAt: '2026-09-01T21:38:18.399Z',
      data: {
        'nestegg-investments-v1': { files: [], movements: [{ id: 'legacy-1' }] },
        'nestegg-prices-v1': { VWCE: { value: 100, source: 'auto' } },
      },
    };
    const result = applyBackup(partial as never)!;
    expect(result.kind).toBe('profile');
    expect(getProfileData(activeId, 'nestegg-investments-v1')).toEqual({ files: [], movements: [{ id: 'legacy-1' }] });
    expect(getProfileData(activeId, 'nestegg-prices-v1')).toEqual({ VWCE: { value: 100, source: 'auto' } });
    // El otro perfil queda intacto.
    expect(getProfileData(other.id, 'nestegg-investments-v1')).toBeUndefined();
  });

  it('recreates a missing profile when restoring an individual backup', () => {
    const backup = {
      app: 'nestegg',
      version: 2,
      kind: 'profile',
      exportedAt: new Date().toISOString(),
      profile: { id: 'ext-1', name: 'Laura' },
      data: { 'nestegg-investments-v1': { files: [], movements: [] } },
    };
    const result = applyBackup(backup)!;
    expect(result.kind).toBe('profile');
    expect(getProfile('ext-1')).toBeDefined();
    expect(getProfile('ext-1')!.name).toBe('Laura');
  });

  it('restores a profile copy into a chosen profile when a target is forced', () => {
    ensureInitialized();
    const p = createProfile('Destino');
    const backup = {
      app: 'nestegg',
      version: 2,
      kind: 'profile',
      exportedAt: new Date().toISOString(),
      profile: { id: 'otro', name: 'Origen' },
      data: {
        'nestegg-investments-v1': { files: [], movements: [{ id: 'f' }] },
        'savings-params': { cushion: 5000 },
      },
    };
    const result = applyBackup(backup, p.id)!;
    expect(result).toEqual({
      kind: 'profile',
      sections: 1,
      profileId: p.id,
      profileName: 'Destino',
    });
    expect(getProfileData(p.id, 'nestegg-investments-v1')).toEqual({ files: [], movements: [{ id: 'f' }] });
    // Las calculadoras compartidas del fichero se ignoran.
    expect(getProfileData(p.id, 'savings-params')).toBeUndefined();
    // El perfil del fichero no se crea.
    expect(getProfile('otro')).toBeUndefined();
  });

  it('restores a single-profile backup authoritatively, removing profiles not in the document', () => {
    ensureInitialized();
    const other = createProfile('Que se elimina');
    setProfileData(other.id, 'nestegg-investments-v1', { files: [], movements: [{ id: 'sobra' }] });
    localStorage.setItem('savings-params', JSON.stringify({ cushion: 1 }));

    const backup = {
      app: 'nestegg',
      version: 2,
      kind: 'profile',
      exportedAt: new Date().toISOString(),
      profile: { id: 'unico', name: 'Único' },
      data: {
        'nestegg-investments-v1': { files: [], movements: [{ id: 'f' }] },
        'savings-params': { cushion: 999 },
      },
    };
    const result = restoreSingleProfileAuthoritative(backup, 'unico', 'Único');
    expect(result.kind).toBe('all');
    expect(getProfiles().map(p => p.id)).toEqual(['unico']);
    expect(getActiveProfileId()).toBe('unico');
    expect(getProfile('unico')!.name).toBe('Único');
    expect(getProfileData('unico', 'nestegg-investments-v1')).toEqual({ files: [], movements: [{ id: 'f' }] });
    // Las calculadoras compartidas del documento se restauran, y los datos del
    // perfil sobrante se eliminan.
    expect(localStorage.getItem('savings-params')).toEqual(JSON.stringify({ cushion: 999 }));
    expect(getProfileData(other.id, 'nestegg-investments-v1')).toBeUndefined();
    expect(localStorage.getItem(profileStorageKey(other.id, 'nestegg-investments-v1'))).toBeNull();
  });

  it('exports and restores a full backup (Agregador por perfil + calculadoras compartidas)', () => {
    ensureInitialized();
    const defaultId = localStorage.getItem(STORAGE_KEY_ACTIVE)!;
    const p1 = createProfile('A');
    const p2 = createProfile('B');
    setProfileData(p1.id, 'nestegg-investments-v1', { files: [], movements: [] });
    localStorage.setItem('savings-params', JSON.stringify({ cushion: 5000 }));
    setProfileData(p2.id, 'nestegg-prices-v1', { X: { value: 1 } });

    const backup = collectAllBackup();
    expect(backup.kind).toBe('all');
    expect(backup.profiles).toHaveLength(3);
    expect(getProfiles().some(p => p.id === p1.id)).toBe(true);
    expect(getProfiles().some(p => p.id === p2.id)).toBe(true);

    localStorage.clear();
    const result = applyBackup(backup)!;
    expect(result.kind).toBe('all');
    expect(getProfiles()).toHaveLength(3);
    expect(localStorage.getItem('savings-params')).toEqual(JSON.stringify({ cushion: 5000 }));
    expect(getProfileData(p1.id, 'nestegg-investments-v1')).toEqual({ files: [], movements: [] });
    expect(getProfileData(p1.id, 'savings-params')).toBeUndefined();
    expect(getProfileData(p2.id, 'nestegg-prices-v1')).toEqual({ X: { value: 1 } });
    expect(getActiveProfileId()).toBe(defaultId);
  });

  it('imports a single profile from a multi-profile backup without touching the rest', () => {
    ensureInitialized();
    const target = createProfile('Laura');
    const other = createProfile('Pedro');
    setProfileData(other.id, 'nestegg-investments-v1', { files: [], movements: [{ id: 'sobra' }] });
    localStorage.setItem('savings-params', JSON.stringify({ cushion: 1 }));

    const backup = {
      app: 'nestegg',
      version: 2,
      kind: 'all',
      exportedAt: new Date().toISOString(),
      profiles: [
        { id: 'a', name: 'Alicia', color: '#0f766e', createdAt: '2026-01-01' },
        { id: 'b', name: 'Berto', color: '#6d28d9', createdAt: '2026-01-01' },
      ],
      data: {
        'nestegg:p:a:nestegg-investments-v1': { files: [], movements: [{ id: 'de-alicia' }] },
        'nestegg:p:b:nestegg-investments-v1': { files: [], movements: [{ id: 'de-berto' }] },
        'savings-params': { cushion: 999 },
      },
    };
    const result = applySingleProfileFromAllBackup(backup as never, 'b', target.id);
    expect(result).toEqual({ kind: 'profile', sections: 1, profileId: target.id, profileName: 'Laura' });
    expect(getProfileData(target.id, 'nestegg-investments-v1')).toEqual({ files: [], movements: [{ id: 'de-berto' }] });
    // El resto de perfiles y las calculadoras no se tocan.
    expect(getProfileData(other.id, 'nestegg-investments-v1')).toEqual({ files: [], movements: [{ id: 'sobra' }] });
    expect(localStorage.getItem('savings-params')).toEqual(JSON.stringify({ cushion: 1 }));
  });

  it('restores an all-backup with a single profile authoritatively (namespaced keys)', () => {
    ensureInitialized();
    const other = createProfile('Se elimina');
    setProfileData(other.id, 'nestegg-investments-v1', { files: [], movements: [{ id: 'sobra' }] });
    localStorage.setItem('savings-params', JSON.stringify({ cushion: 1 }));

    const backup = {
      app: 'nestegg',
      version: 2,
      kind: 'all',
      exportedAt: new Date().toISOString(),
      profiles: [{ id: 'unicId', name: 'Única', color: '#0f766e', createdAt: '2026-01-01' }],
      data: {
        'nestegg:p:unicId:nestegg-investments-v1': { files: [], movements: [{ id: 'f' }] },
        'nestegg-prices-v1': undefined,
        'savings-params': { cushion: 999 },
      },
    };
    const result = restoreSingleProfileAuthoritative(backup as never, 'unicId', 'Única');
    expect(result.kind).toBe('all');
    expect(getProfiles().map(p => p.id)).toEqual(['unicId']);
    expect(getActiveProfileId()).toBe('unicId');
    expect(getProfile('unicId')!.name).toBe('Única');
    expect(getProfileData('unicId', 'nestegg-investments-v1')).toEqual({ files: [], movements: [{ id: 'f' }] });
    expect(localStorage.getItem('savings-params')).toEqual(JSON.stringify({ cushion: 999 }));
    expect(getProfileData(other.id, 'nestegg-investments-v1')).toBeUndefined();
  });

  it('restores a v1 flat backup (1 implicit profile) authoritatively, deleting the rest', () => {
    ensureInitialized();
    const activeId = getActiveProfileId();
    const other = createProfile('Sobrante');
    setProfileData(other.id, 'nestegg-investments-v1', { files: [], movements: [{ id: 'sobra' }] });
    localStorage.setItem('savings-params', JSON.stringify({ cushion: 1 }));

    const backup = {
      app: 'nestegg',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        'savings-params': { cushion: 999 },
        'nestegg-tab': 'investments',
        'nestegg-investments-v1': { files: [], movements: [{ id: 'f' }] },
        'nestegg-prices-v1': { IE00B4ND3602: { value: 77.23, source: 'manual' } },
      },
    };
    const result = restoreSingleProfileAuthoritative(backup as never, activeId);
    expect(result.kind).toBe('all');
    expect(getProfiles().map(p => p.id)).toEqual([activeId]);
    expect(getActiveProfileId()).toBe(activeId);
    expect(getProfileData(activeId, 'nestegg-investments-v1')).toEqual({ files: [], movements: [{ id: 'f' }] });
    expect(getProfileData(activeId, 'nestegg-prices-v1')).toEqual({ IE00B4ND3602: { value: 77.23, source: 'manual' } });
    expect(localStorage.getItem('savings-params')).toEqual(JSON.stringify({ cushion: 999 }));
    expect(localStorage.getItem('nestegg-tab')).toEqual(JSON.stringify('investments'));
    expect(getProfileData(other.id, 'nestegg-investments-v1')).toBeUndefined();
  });

  it('rejects payloads that are not NestEgg backups', () => {
    expect(applyBackup({ app: 'other', kind: 'all', data: { a: 1 } } as never)).toBeNull();
    expect(applyBackup({ app: 'nestegg', kind: 'all' } as never)).toBeNull();
  });
});

describe('joint config', () => {
  beforeEach(() => localStorage.clear());

  it('persists and reads joint categories', () => {
    saveJointConfig({ jointCategories: ['Vivienda', 'Suministros e Internet'] });
    expect(getJointConfig()).toEqual({ jointCategories: ['Vivienda', 'Suministros e Internet'] });
  });

  it('defaults to empty list', () => {
    expect(getJointConfig()).toEqual({ jointCategories: [] });
  });
});

function getActiveId(): string | null {
  return localStorage.getItem(STORAGE_KEY_ACTIVE);
}