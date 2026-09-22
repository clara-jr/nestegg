import { useState } from 'react';
import { Modal, Icon } from './common';
import { useI18n } from '../lib/i18n';
import { PROFILE_COLORS, getProfileData, setActiveProfileId, useProfiles } from '../lib/profiles';

function hasImportedFiles(profileId: string): boolean {
  const data = getProfileData(profileId, 'nestegg-investments-v1') as
    | { files?: unknown[] }
    | undefined;
  return Array.isArray(data?.files) && data!.files.length > 0;
}

/**
 * Selector y gestor de perfiles integrado en el Agregador de Finanzas. Cada
 * perfil guarda por separado únicamente los datos de este Agregador (extractos,
 * precios y depósitos a plazo); las calculadoras son compartidas.
 */
export default function ProfileSelector() {
  const { t } = useI18n();
  const { profiles, activeId, activeProfile, create, rename, setColor, remove } = useProfiles();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#0f766e');
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

  const confirmCreate = () => {
    if (!newName.trim()) return;
    create(newName);
    setNewName('');
    setAdding(false);
  };

  const confirmRename = () => {
    if (!editing) return;
    rename(editing.id, editName);
    setColor(editing.id, editColor);
    setEditing(null);
  };

  const confirmDelete = () => {
    if (!deleting) return;
    remove(deleting.id);
    setDeleting(null);
  };

  return (
    <>
      <section className="bg-[#fdfdfe] border border-gray-200 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          {profiles.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { if (p.id !== activeId) setActiveProfileId(p.id); }}
              title={t('profiles.view', { name: p.name })}
              className={`inline-flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full text-sm font-medium cursor-pointer border ${
                p.id === activeId
                  ? 'bg-zinc-100 text-gray-900 border-gray-200'
                  : 'bg-[#fdfdfe] border-gray-200 text-gray-700 hover:bg-zinc-100'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
              {p.name}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2 leading-relaxed">
          {profiles.length > 1 ? t('profiles.multiHint') : t('profiles.singleHint')}
        </p>
        <div className="flex items-center gap-2 justify-end mt-3">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-zinc-100 border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-200 transition-colors cursor-pointer"
          >
            + {t('profiles.addNew')}
          </button>
          {activeProfile && (
            <button
              type="button"
              onClick={() => { setEditing({ id: activeProfile.id, name: activeProfile.name, color: activeProfile.color }); setEditName(activeProfile.name); setEditColor(activeProfile.color); }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-100 transition-colors cursor-pointer"
            >
              <Icon name="edit" className="h-3.5 w-3.5" />
              {t('profiles.edit')}
            </button>
          )}
        </div>
      </section>

      <Modal open={adding} onClose={() => setAdding(false)} title={t('profiles.newProfile')}>
        <p className="text-sm text-gray-600 leading-relaxed mb-3">
          {t('profiles.newProfileDesc')}
        </p>
        <input
          autoFocus
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && confirmCreate()}
          placeholder={t('profiles.namePlaceholder')}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 mb-3"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="px-4 py-2 rounded-xl border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-100 transition-colors cursor-pointer"
          >
            {t('profiles.cancel')}
          </button>
          <button
            type="button"
            onClick={confirmCreate}
            disabled={!newName.trim()}
            className="px-4 py-2 rounded-xl bg-zinc-100 border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-40 cursor-pointer"
          >
            {t('profiles.create')}
          </button>
        </div>
      </Modal>

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={t('profiles.editProfile')}>
          <input
            autoFocus
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && confirmRename()}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 mb-4"
          />
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{t('profiles.color')}</label>
          <div className="flex items-center gap-2 flex-wrap mb-4">
            {PROFILE_COLORS.map(color => (
              <button
                key={color}
                type="button"
                onClick={() => setEditColor(color)}
                aria-label={t('profiles.colorAria', { color })}
                title={t('profiles.colorAria', { color })}
                className={`w-7 h-7 rounded-full cursor-pointer transition-transform ${
                  editColor.toLowerCase() === color ? 'ring-2 ring-gray-900 ring-offset-2 scale-110' : 'hover:scale-110'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <input
                type="color"
                value={editColor}
                onChange={e => setEditColor(e.target.value)}
                className="w-7 h-7 rounded cursor-pointer border border-gray-200 p-0.5 bg-transparent"
                title={t('profiles.customColor')}
              />
              <span className="whitespace-nowrap">{t('profiles.custom')}</span>
            </div>
          </div>
          <div className="flex justify-between items-center gap-2">
            <button
              type="button"
              onClick={() => { setDeleting({ id: editing.id, name: editName }); setEditing(null); }}
              disabled={profiles.length <= 1}
              className="px-3 py-2 rounded-xl text-red-600 text-sm font-semibold hover:bg-red-50 transition-colors disabled:opacity-40 cursor-pointer"
            >
              {t('profiles.delete')}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-100 transition-colors cursor-pointer"
              >
                {t('profiles.cancel')}
              </button>
              <button
                type="button"
                onClick={confirmRename}
                disabled={!editName.trim()}
                className="px-4 py-2 rounded-xl bg-zinc-100 border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-40 cursor-pointer"
              >
                {t('profiles.save')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal open onClose={() => setDeleting(null)} title={t('profiles.deleteProfile')}>
          <p className="text-sm text-gray-600 leading-relaxed mb-1">
            {t('profiles.deleteConfirm', { name: deleting.name })}
          </p>
          {hasImportedFiles(deleting.id) && (
            <p className="text-xs text-amber-600 leading-relaxed mb-3">
              {t('profiles.deleteHasImports')}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleting(null)}
              className="px-4 py-2 rounded-xl border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-100 transition-colors cursor-pointer"
            >
              {t('profiles.cancel')}
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              className="px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors cursor-pointer"
            >
              {t('profiles.delete')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}