import { useRef, useState } from 'react';
import { Modal, Select, Tooltip, Icon } from './common';
import {
  DATA_CHANGED_EVENT,
  PROFILE_CHANGED_EVENT,
  PROFILE_DATA_KEYS,
  applyBackup,
  applySingleProfileFromAllBackup,
  collectAllBackup,
  collectProfileBackup,
  dispatchDataChanged,
  getActiveProfileId,
  getProfile,
  getProfiles,
  restoreSingleProfileAuthoritative,
  useProfiles,
  type BackupPayload,
  type ImportResult,
  type Profile,
} from '../lib/profiles';

interface Feedback {
  kind: 'success' | 'warning' | 'error';
  text: string;
}

type Scope = 'all' | 'profile';

interface RestoreTarget {
  scope: Scope;
  selectedId: string;
}

interface PendingSingleFull {
  payload: BackupPayload;
  profileId: string;
  profileName?: string;
}

interface PendingChoice {
  payload: BackupPayload;
  fileProfiles: Profile[];
  targetId: string;
  targetName: string;
}

interface FileSingleInfo {
  profileId?: string;
  profileName?: string;
}

/**
 * Lista de perfiles que contiene el fichero. Fuente primaria: la propiedad
 * `profiles` del documento y su longitud; si el fichero no la lista, se busca
 * `data['nestegg-profiles']`; y si tampoco, se derivan los ids de los bloques
 * namespaced del Agregador (`nestegg:p:{id}:…`). Devuelve null solo si no hay
 * ninguna evidencia de perfiles en el documento.
 */
function fileProfilesList(payload: BackupPayload): Profile[] | null {
  if (Array.isArray(payload.profiles)) return payload.profiles;
  const data = payload.data ?? {};
  if (Array.isArray(data['nestegg-profiles'])) return data['nestegg-profiles'] as Profile[];
  const ids = new Set<string>();
  for (const key of Object.keys(data)) {
    const match = /^nestegg:p:([^:]+):/.exec(key);
    if (match) ids.add(match[1]);
  }
  const derived = [...ids].map(id => ({
    id,
    name: id,
    color: '#64748b',
    createdAt: new Date(0).toISOString(),
  }));
  return derived.length > 0 ? derived : null;
}

/**
 * Determina si el fichero representa un único perfil y, en ese caso, qué perfil
 * es. Revisa la propiedad `profiles` del documento (y la lista embebida en
 * `data['nestegg-profiles']`), y para copias v1/v2 sin lista deduce un único
 * perfil implícito cuando el documento solo trae claves del Agregador.
 * Devuelve null para ficheros con varios perfiles o de alcance desconocido.
 */
function fileSingleProfileInfo(payload: BackupPayload): FileSingleInfo | null {
  const listed = fileProfilesList(payload);
  if (listed) {
    if (listed.length === 1) {
      return { profileId: listed[0]?.id, profileName: listed[0]?.name };
    }
    return null;
  }
  if (payload.kind === 'profile') {
    return { profileId: payload.profile?.id, profileName: payload.profile?.name };
  }
  const data = payload.data ?? {};
  // Un documento con claves planas del Agregador (con o sin calculadoras
  // compartidas) es una copia v1 de un único perfil implícito: las claves
  // planas no pueden representar a varios perfiles.
  const hasFlatAggregator = (PROFILE_DATA_KEYS as readonly string[]).some(k => k in data);
  if (hasFlatAggregator) return { profileId: undefined, profileName: undefined };
  const hasGlobalKeys = Object.keys(data).some(k => !(PROFILE_DATA_KEYS as readonly string[]).includes(k));
  return hasGlobalKeys ? null : { profileId: undefined, profileName: undefined };
}

function download(payload: BackupPayload, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function BackupRestore() {
  const { profiles } = useProfiles();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [kind, setKind] = useState<'download' | 'restore' | null>(null);
  const [scope, setScope] = useState<Scope>('all');
  const [selectedId, setSelectedId] = useState<string>(getActiveProfileId());
  const [pendingSingleFull, setPendingSingleFull] = useState<PendingSingleFull | null>(null);
  const [pendingChoice, setPendingChoice] = useState<PendingChoice | null>(null);
  const [fileProfileId, setFileProfileId] = useState<string>('');
  const pendingRestore = useRef<RestoreTarget | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openArranger = (next: 'download' | 'restore') => {
    setScope('all');
    setSelectedId(getActiveProfileId());
    setKind(next);
  };

  const confirmDownload = () => {
    if (scope === 'profile') {
      const profile = getProfile(selectedId);
      const payload = collectProfileBackup(selectedId);
      if (!payload || !profile) {
        setFeedback({ kind: 'warning', text: 'No se encontró el perfil seleccionado.' });
        return;
      }
      download(payload, `nestegg-perfil-${profile.name}-${new Date().toISOString().slice(0, 10)}.json`);
      setFeedback({ kind: 'success', text: `Copia del perfil «${profile.name}» descargada.` });
    } else {
      download(collectAllBackup(), `nestegg-copia-completa-${new Date().toISOString().slice(0, 10)}.json`);
      setFeedback({ kind: 'success', text: 'Copia completa descargada (perfiles + datos globales).' });
    }
    setKind(null);
  };

  const confirmRestore = () => {
    pendingRestore.current = { scope, selectedId };
    setKind(null);
    fileInputRef.current?.click();
  };

  const confirmSingleFull = () => {
    if (!pendingSingleFull) return;
    const { payload, profileId, profileName } = pendingSingleFull;
    restoreSingleProfileAuthoritative(payload, profileId, profileName);
    const name = getProfile(profileId)?.name ?? 'perfil restaurado';
    setPendingSingleFull(null);
    setFeedback({ kind: 'success', text: `«${name}» restaurado y perfiles sobrantes eliminados.` });
    dispatchDataChanged();
    window.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT));
  };

  const confirmChoice = () => {
    if (!pendingChoice || !fileProfileId) return;
    const { payload, targetId, targetName } = pendingChoice;
    const chosen = pendingChoice.fileProfiles.find(p => p.id === fileProfileId);
    const result = applySingleProfileFromAllBackup(payload, fileProfileId, targetId);
    if (result.sections === 0) {
      setFeedback({ kind: 'warning', text: 'El perfil elegido de la copia no contiene datos del Agregador.' });
      setPendingChoice(null);
      return;
    }
    setPendingChoice(null);
    setFeedback({
      kind: 'success',
      text: `Agregador de «${targetName}» restaurado desde «${chosen?.name ?? 'perfil'}».`,
    });
    dispatchDataChanged();
    window.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT));
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const target = pendingRestore.current;
    pendingRestore.current = null;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result)) as BackupPayload & { kind?: unknown; data?: unknown };
        const data = (payload.data ?? {}) as Record<string, unknown>;
        if (typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length === 0) {
          setFeedback({ kind: 'warning', text: 'El fichero no contiene datos de NestEgg reconocibles.' });
          return;
        }
        let result: ImportResult | null;
        let note = '';

        if (target?.scope === 'profile') {
          const listed = fileProfilesList(payload as BackupPayload);
          const targetProfile = getProfile(target.selectedId);
          const targetName = targetProfile?.name ?? 'perfil';
          const withId = (listed ?? []).filter(p => typeof p?.id === 'string' && p.id);
          const targetNameKey = targetName.trim().toLowerCase();
          const matched = withId.find(fp => (fp.name ?? '').trim().toLowerCase() === targetNameKey);
          if (withId.length > 0 && matched) {
            // El fichero trae varios perfiles y uno comparte nombre con el
            // destino: se usa ese perfil directamente (se informa del resto).
            result = applySingleProfileFromAllBackup(payload as BackupPayload, matched.id, target.selectedId);
            note = withId.length > 1
              ? `Se ha restaurado el Agregador de «${targetName}» desde el perfil «${matched.name ?? targetName}» de los ${withId.length} encontrados en el fichero`
              : `Agregador de «${targetName}» restaurado`;
          } else if (withId.length > 1 || (withId.length === 1 && (withId[0]?.name ?? '').trim().toLowerCase() !== targetNameKey)) {
            // Varios perfiles sin coincidencia de nombre (o uno solo con nombre
            // distinto): hay que elegir de cuál tomar los datos y confirmarlo.
            setFileProfileId(matched?.id ?? withId[0]?.id);
            setPendingChoice({
              payload: payload as BackupPayload,
              fileProfiles: withId,
              targetId: target.selectedId,
              targetName,
            });
            return;
          } else if (withId.length === 1) {
            // Un único perfil documentado y coincide con el destino: importación
            // directa del Agregador (claves namespaced o planas según el fichero).
            result = applySingleProfileFromAllBackup(payload as BackupPayload, withId[0].id, target.selectedId);
            note = `Agregador de «${targetName}» restaurado`;
          } else if (payload.kind === 'all') {
            // Copia completa sin listado de perfiles: no se puede desgranar.
            result = applyBackup(payload as BackupPayload);
            note = 'El fichero es una copia completa y no se puede restaurar a un solo perfil; se restaurará todo.';
          } else {
            result = applyBackup(payload as BackupPayload, target.selectedId);
            note = `Agregador de «${targetName}» restaurado`;
          }
        } else {
          const singleInfo = fileSingleProfileInfo(payload as BackupPayload);
          if (singleInfo) {
            const profileId = singleInfo.profileId ?? getActiveProfileId();
            const profileName = singleInfo.profileName;
            if (getProfiles().length > 1) {
              // «Todo» con un fichero de un único perfil y varios perfiles en el
              // sistema: requiere confirmación, ya que se eliminarían los que no
              // estén en el documento.
              setPendingSingleFull({ payload: payload as BackupPayload, profileId, profileName });
              return;
            }
            // No hay otros perfiles que se eliminen: se restaura directamente.
            result = restoreSingleProfileAuthoritative(payload as BackupPayload, profileId, profileName);
            note = `Se han restaurado ${result?.sections ?? 0} secciones`;
          } else {
            result = applyBackup(payload as BackupPayload);
            if (result?.kind === 'profile') {
              note = 'El fichero solo contiene la copia de un perfil; se ha restaurado únicamente ese perfil.';
            } else {
              note = `Se han restaurado ${result?.sections ?? 0} secciones`;
            }
          }
        }

        if (!result) {
          setFeedback({ kind: 'error', text: 'No se pudo leer el fichero. ¿Es una copia de NestEgg?' });
          return;
        }
        if (result.sections === 0) {
          setFeedback({ kind: 'warning', text: 'El fichero no contiene datos de NestEgg reconocibles.' });
          return;
        }
        setFeedback({ kind: 'success', text: `${note}.` });
        dispatchDataChanged();
        window.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT));
      } catch {
        setFeedback({ kind: 'error', text: 'No se pudo leer el fichero. ¿Es una copia de NestEgg?' });
      }
    };
    reader.readAsText(file);
  };

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 flex items-end gap-2">
        {open && (
          <div className="bg-[#fdfdfe] border border-gray-200 rounded-xl shadow-lg p-4 w-72 text-sm">
            <p className="font-semibold text-gray-900 mb-1.5">Copia de seguridad</p>
            <p className="text-xs text-gray-500 leading-relaxed mb-2">
              Descarga o restaura los datos guardados en este navegador. Puedes elegir entre un solo
              perfil (solo su parte del Agregador de Finanzas) o todos los datos.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => openArranger('download')}
                className="px-4 py-2 rounded-xl bg-zinc-100 border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                <Icon name="download" className="h-4 w-4 inline mr-1.5 -mt-0.5" />
                Descargar copia
              </button>
              <button
                type="button"
                onClick={() => openArranger('restore')}
                className="px-4 py-2 rounded-xl bg-zinc-100 border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-200 transition-colors cursor-pointer"
              >
                <Icon name="upload" className="h-4 w-4 inline mr-1.5 -mt-0.5" />
                Restaurar copia
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={e => handleFile(e.target.files?.[0])}
              />
            </div>
            {feedback && (
              <p className={`mt-3 text-xs leading-relaxed ${
                feedback.kind === 'success' ? 'text-emerald-700'
                  : feedback.kind === 'warning' ? 'text-amber-700'
                  : 'text-red-700'
              }`}>
                {feedback.text}
              </p>
            )}
          </div>
        )}

        <Modal
          open={kind === 'download'}
          onClose={() => setKind(null)}
          title="Descargar copia de seguridad"
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="download-scope"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold text-gray-900 text-sm">Todo</span>
                  <span className="block text-xs text-gray-500">Perfiles, datos del Agregador y calculadoras compartidas.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="download-scope"
                  checked={scope === 'profile'}
                  onChange={() => setScope('profile')}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold text-gray-900 text-sm">Un solo perfil</span>
                  <span className="block text-xs text-gray-500">Solo su parte del Agregador de Finanzas.</span>
                </span>
              </label>
            </div>
            {scope === 'profile' && (
              <Select
                value={selectedId}
                size="md"
                fullWidth
                ariaLabel="Perfil"
                onChange={setSelectedId}
                options={profiles.map(p => ({
                  value: p.id,
                  label: p.name,
                  icon: <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: p.color }} />,
                }))}
              />
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setKind(null)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-100 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDownload}
                disabled={!profiles.length}
                className="px-4 py-2 rounded-xl bg-zinc-100 border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-40 cursor-pointer"
              >
                Descargar
              </button>
            </div>
          </div>
        </Modal>

        <Modal
          open={kind === 'restore'}
          onClose={() => setKind(null)}
          title="Restaurar copia de seguridad"
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="restore-scope"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold text-gray-900 text-sm">Todo</span>
                  <span className="block text-xs text-gray-500">Restaura perfiles y datos globales del fichero. Si la copia contiene menos perfiles que los actuales, se eliminarán los que no estén en ella.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="restore-scope"
                  checked={scope === 'profile'}
                  onChange={() => setScope('profile')}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold text-gray-900 text-sm">Un solo perfil</span>
                  <span className="block text-xs text-gray-500">Aplica el fichero solo al Agregador del perfil elegido. Si la copia trae varios perfiles podrás elegir cuál importar.</span>
                </span>
              </label>
            </div>
            {scope === 'profile' && (
              <Select
                value={selectedId}
                size="md"
                fullWidth
                ariaLabel="Perfil"
                onChange={setSelectedId}
                options={profiles.map(p => ({
                  value: p.id,
                  label: p.name,
                  icon: <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: p.color }} />,
                }))}
              />
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setKind(null)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-100 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmRestore}
                disabled={!profiles.length}
                className="px-4 py-2 rounded-xl bg-zinc-100 border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-40 cursor-pointer"
              >
                Elegir fichero
              </button>
            </div>
          </div>
        </Modal>

        <Modal
          open={pendingChoice !== null}
          onClose={() => setPendingChoice(null)}
          title="Restaurar un perfil desde la copia"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600 leading-relaxed">
              La copia trae <span className="font-semibold text-gray-900">{pendingChoice?.fileProfiles.length ?? 0} perfil{pendingChoice && pendingChoice.fileProfiles.length !== 1 ? 'es' : ''}</span>{' '}
              y has elegido restaurar uno solo. No se tocarán las calculadoras compartidas ni el
              resto de perfiles.
            </p>
            {pendingChoice && (
              <>
                {!pendingChoice.fileProfiles.some(fp =>
                  (fp.name ?? '').trim().toLowerCase() === pendingChoice.targetName.trim().toLowerCase()) && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5 leading-relaxed">
                    Ninguno de los perfiles de la copia se llama «{pendingChoice.targetName}». Indica a
                    continuación de qué perfil de la copia quieres tomar los datos.
                  </p>
                )}
                <Select
                  value={fileProfileId}
                  size="md"
                  fullWidth
                  ariaLabel="Perfil de la copia"
                  onChange={setFileProfileId}
                  options={pendingChoice.fileProfiles.map(p => ({
                    value: p.id,
                    label: p.name,
                    icon: <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: p.color }} />,
                  }))}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingChoice(null)}
                    className="px-4 py-2 rounded-xl border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-100 transition-colors cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={confirmChoice}
                    className="px-4 py-2 rounded-xl bg-zinc-100 border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-200 transition-colors cursor-pointer"
                  >
                    Restaurar en «{pendingChoice.targetName}»
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>

        <Modal
          open={pendingSingleFull !== null}
          onClose={() => setPendingSingleFull(null)}
          title="Restaurar todo desde un único perfil"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600 leading-relaxed">
              {pendingSingleFull?.profileName ? (
                <>
                  El fichero seleccionado solo contiene el perfil{' '}
                  <span className="font-semibold text-gray-900">«{pendingSingleFull.profileName}»</span>.{' '}
                </>
              ) : (
                'El fichero seleccionado solo contiene un perfil. '
              )}
              Al restaurar <span className="font-semibold">todo</span>, la navegación quedará con ese
              único perfil y los perfiles actuales que no estén en la copia se eliminarán
              definitivamente.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingSingleFull(null)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-100 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmSingleFull}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors cursor-pointer"
              >
                Restaurar y eliminar el resto
              </button>
            </div>
          </div>
        </Modal>

        <Tooltip text="Copiar o restaurar datos">
          <button
            type="button"
            onClick={() => { setOpen(o => !o); setFeedback(null); }}
            aria-label="Copia de seguridad de tus datos"
            className="w-12 h-12 flex items-center justify-center rounded-full bg-zinc-100 border border-gray-200 text-gray-900 hover:bg-zinc-200 cursor-pointer"
          >
            <Icon name="floppy" className="h-6 w-6" />
          </button>
        </Tooltip>
      </div>
    </>
  );
}