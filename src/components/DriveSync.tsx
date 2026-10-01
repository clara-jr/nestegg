import { useEffect, useRef, useState } from 'react';
import { Modal } from './common';
import { useI18n, localeOf } from '../lib/i18n';
import {
  getSyncState,
  getSyncFolderId,
  login,
  logout,
  resolveConflict,
  start,
  subscribeDriveSync,
  syncNow,
  type DriveSyncState,
} from '../lib/driveSync';

function GoogleLogo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"
      />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.3 4.1-4.2 5.5l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}

function statusDot(kind: string, className = '') {
  if (kind === 'synced') return `bg-emerald-500 ${className}`;
  if (kind === 'error' || kind === 'conflict') return `bg-red-500 ${className}`;
  if (kind === 'logged-out') return `bg-gray-300 ${className}`;
  return `bg-amber-400 ${className}`;
}

function SpinnerIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={`animate-spin shrink-0 ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="h-4 w-4 inline mr-1.5 -mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

export default function DriveSync({ variant = 'floating' }: { variant?: 'floating' | 'menu' | 'nav' }) {
  const { lang, t } = useI18n();
  const [state, setState] = useState<DriveSyncState>(() => getSyncState());
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTop, setPanelTop] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = subscribeDriveSync(() => setState(getSyncState()));
    void start();
    return unsub;
  }, []);

  useEffect(() => {
    if (variant !== 'menu' || !panelOpen) return;
    const menu = document.getElementById('nav-mobile-menu');
    const cardEl = cardRef.current;
    if (menu && cardEl) {
      const bottom = menu.getBoundingClientRect().bottom;
      const h = cardEl.offsetHeight;
      const fits = bottom + 8 + h <= window.innerHeight - 12;
      setPanelTop(fits ? bottom + 8 : null);
    }
  }, [variant, panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = panelRef.current;
      const target = e.target as Node;
      if (!el || (target !== el && el.contains(target))) return;
      setPanelOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [panelOpen]);

  const kind = state.status.kind;
  const isLoggedIn = kind !== 'logged-out';
  const busy = kind === 'connecting' || kind === 'syncing';
  const syncFolderId = getSyncFolderId();
  const syncFolderUrl = syncFolderId
    ? `https://drive.google.com/drive/u/0/folders/${encodeURIComponent(syncFolderId)}`
    : null;

  const statusText = (() => {
    switch (kind) {
      case 'synced':
        return t('drive.synced');
      case 'syncing':
        return t('drive.syncing');
      case 'connecting':
        return t('drive.connecting');
      case 'conflict':
        return t('drive.conflict.short');
      case 'error':
        return t(`drive.error.${state.status.code}`);
      default:
        return '';
    }
  })();

  const lastSynced = kind === 'synced' && state.status.kind === 'synced'
    ? new Date(state.status.lastSyncedAt).toLocaleString(localeOf(lang))
    : '';

  const conflictModal = (
    <Modal
      open={kind === 'conflict'}
      title={t('drive.conflict.title')}
      hideCloseButton
      dismissible={false}
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 leading-relaxed">{t('drive.conflict.text')}</p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void resolveConflict('remote')}
            className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-800 transition-colors cursor-pointer"
          >
            {t('drive.conflict.remote')}
          </button>
          <p className="text-xs text-gray-500 -mt-1">{t('drive.conflict.remoteDesc')}</p>
          <button
            type="button"
            onClick={() => void resolveConflict('local')}
            className="px-4 py-2 rounded-xl bg-zinc-100 border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-200 transition-colors cursor-pointer"
          >
            {t('drive.conflict.local')}
          </button>
          <p className="text-xs text-gray-500 -mt-1">{t('drive.conflict.localDesc')}</p>
        </div>
      </div>
    </Modal>
  );

  const onToggle = () => {
    if (isLoggedIn) setPanelOpen(o => !o);
    else void login();
  };

  const panelCard = isLoggedIn && (
    <div ref={cardRef} className="w-80 bg-[#fdfdfe] border border-gray-200 rounded-xl shadow-lg p-4 text-sm">
      <p className="font-semibold text-gray-900">
        {state.user?.displayName ?? t('drive.drive')}
      </p>
      {state.user?.emailAddress && (
        <p className="text-xs text-gray-500 mt-0.5 break-all">{state.user.emailAddress}</p>
      )}
      <div className="mt-3 border-t border-gray-100 pt-3">
        <span className="text-xs text-gray-500">{t('drive.location')}: </span>
        {syncFolderUrl ? (
          <a
            href={syncFolderUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={t('drive.openLocation')}
            className="mt-0.5 inline-block text-xs font-semibold text-gray-900 underline decoration-gray-300 underline-offset-2 hover:decoration-gray-900"
          >
            {t('drive.drive')} / NestEgg
          </a>
        ) : (
          <span className="mt-0.5 block text-xs font-semibold text-gray-900">
            {t('drive.drive')} / NestEgg
          </span>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-gray-600">
        <span className={`w-2 h-2 rounded-full ${statusDot(kind)} shrink-0`} />
        <span>{statusText}</span>
      </div>
      {kind === 'synced' && lastSynced && (
        <p className="mt-1 text-xs text-gray-400">{t('drive.lastSynced', { time: lastSynced })}</p>
      )}
      {kind === 'error' && state.status.kind === 'error' && state.status.code === 'config' && (
        <p className="mt-2 text-xs leading-relaxed text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
          {t('drive.error.configHint')}
        </p>
      )}
      <div className="flex flex-col gap-2 mt-3">
        <button
          type="button"
          onClick={() => void syncNow()}
          disabled={busy}
          className="px-3 py-2 rounded-xl bg-zinc-100 border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-200 transition-colors disabled:opacity-40 cursor-pointer"
        >
          <RefreshIcon />
          {t('drive.syncNow')}
        </button>
        <button
          type="button"
          onClick={() => { void logout(); setPanelOpen(false); }}
          className="px-3 py-2 rounded-xl border border-gray-200 text-gray-900 text-sm font-semibold hover:bg-zinc-100 transition-colors cursor-pointer"
        >
          {t('drive.logout')}
        </button>
      </div>
    </div>
  );

  if (variant === 'nav') {
    return (
      <div ref={panelRef} className="relative">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={panelOpen}
          aria-label={isLoggedIn ? t('drive.openAria') : t('drive.login')}
          className="relative w-9 h-9 flex items-center justify-center rounded-full text-gray-900 hover:bg-zinc-100 transition-colors cursor-pointer"
        >
          {isLoggedIn && state.user?.photoLink ? (
            <img
              src={state.user.photoLink}
              alt=""
              className="w-8 h-8 rounded-full"
              referrerPolicy="no-referrer"
            />
          ) : (
            <GoogleLogo className="w-5 h-5 shrink-0" />
          )}
          {isLoggedIn && (
            <span
              aria-hidden="true"
              className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-[#fdfdfe] flex items-center justify-center ${statusDot(kind)}`}
            >
              {busy && <SpinnerIcon className="w-3 h-3 text-white" />}
            </span>
          )}
        </button>
        {panelOpen && <div className="absolute right-0 top-full mt-2 z-50">{panelCard}</div>}
        {conflictModal}
      </div>
    );
  }

  if (variant === 'menu') {
    return (
      <div ref={panelRef} className="relative">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={panelOpen}
          className="flex items-center gap-3 w-full px-5 py-3.5 text-sm font-semibold text-gray-600 text-left transition-colors hover:bg-zinc-100 hover:text-gray-900 cursor-pointer"
        >
          {isLoggedIn ? (
            <>
              <span className={`w-2 h-2 rounded-full ${statusDot(kind)} shrink-0`} />
              <GoogleLogo className="w-5 h-5 flex-shrink-0" />
              <span className="truncate">
                {state.user?.displayName ?? state.user?.emailAddress ?? t('drive.login')}
              </span>
            </>
          ) : (
            <>
              <GoogleLogo className="w-5 h-5 flex-shrink-0" />
              <span>{t('drive.login')}</span>
            </>
          )}
          {busy && <SpinnerIcon />}
        </button>
        {panelOpen && (
          <div
            className={panelTop != null ? 'fixed left-1/2 -translate-x-1/2 z-50' : 'fixed inset-0 flex items-center justify-center z-50 pointer-events-none'}
            style={panelTop != null ? { top: panelTop } : undefined}
          >
            <div className={panelTop != null ? '' : 'pointer-events-auto'}>{panelCard}</div>
          </div>
        )}
        {conflictModal}
      </div>
    );
  }

  return (
    <div ref={panelRef} className="hidden md:flex fixed top-5.5 lg:top-6.5 right-4 z-50 items-start gap-2">
      {isLoggedIn && panelOpen && panelCard}

      <button
        type="button"
        onClick={onToggle}
        aria-label={isLoggedIn ? t('drive.openAria') : t('drive.login')}
        aria-expanded={panelOpen}
        className="relative w-9 h-9 flex items-center justify-center rounded-full bg-zinc-100 border border-gray-200 text-gray-900 hover:bg-zinc-200 transition-colors cursor-pointer"
      >
        {isLoggedIn && state.user?.photoLink ? (
          <img
            src={state.user.photoLink}
            alt=""
            className="w-full h-full rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <GoogleLogo className="w-5 h-5 shrink-0" />
        )}
        {isLoggedIn && (
          <span
            aria-hidden="true"
            className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-[#fdfdfe] flex items-center justify-center ${statusDot(kind)}`}
          >
            {busy && (
              <SpinnerIcon className="w-3 h-3 text-white" />
            )}
          </span>
        )}
      </button>

      {conflictModal}
    </div>
  );
}