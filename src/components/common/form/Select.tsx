import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../../../lib/i18n';

export interface SelectOption {
  value: string;
  label: string;
  /** Icono que precede al nombre de la opción (en el botón y en el desplegable). */
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  groups?: SelectGroup[];
  placeholder?: string;
  /** xs: compacto (tablas), sm: normal, md: grande (inputs de formulario). */
  size?: 'xs' | 'sm' | 'md';
  fullWidth?: boolean;
  dark?: boolean;
  ariaLabel?: string;
  className?: string;
  /** Icono fijo al inicio del botón, separado del contenido por una línea vertical fina. */
  leadingIcon?: ReactNode;
}

const SIZE_CLASSES: Record<NonNullable<SelectProps['size']>, string> = {
  xs: 'px-2 py-1 text-xs rounded-md',
  sm: 'px-2.5 py-1.5 text-sm rounded-xl',
  md: 'px-3 py-2 text-sm rounded-xl',
};

/** Márgenes negativos que compensan el padding vertical del botón para que el
 *  separador del leadingIcon llegue hasta arriba y abajo del input. */
const LEADING_MARGINS: Record<NonNullable<SelectProps['size']>, string> = {
  xs: '-my-1',
  sm: '-my-1.5',
  md: '-my-2',
};

function ChevronIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0 opacity-60"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Selector desplegable propio (estilo custom para sustituir al <select>
 *  nativo). Soporta iconos por opción, grupos y variante oscura. */
export function Select({
  value,
  onChange,
  options = [],
  groups,
  placeholder,
  size = 'sm',
  fullWidth = false,
  dark = false,
  ariaLabel,
  className = '',
  leadingIcon,
}: SelectProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Posiciona el menú con posición fija (sale del flujo y de los contenedores
  // con overflow de las tablas) anclado al botón. Abre hacia arriba cuando no
  // cabe debajo dentro de la parte visible de la pantalla.
  const positionMenu = useCallback(() => {
    const root = ref.current;
    const menu = menuRef.current;
    if (!root || !menu) return;
    const btn = root.querySelector('button');
    if (!btn) return;
    const btnRect = btn.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;
    const gap = 4;
    const spaceBelow = window.innerHeight - btnRect.bottom;
    const spaceAbove = btnRect.top;
    const upward = menuHeight + gap > spaceBelow && spaceAbove > spaceBelow;
    menu.style.left = `${btnRect.left}px`;
    menu.style.width = `${btnRect.width}px`;
    menu.style.top = upward
      ? `${Math.max(8, btnRect.top - menuHeight - gap)}px`
      : `${btnRect.bottom + gap}px`;
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    positionMenu();
    window.addEventListener('scroll', positionMenu, true);
    window.addEventListener('resize', positionMenu);
    return () => {
      window.removeEventListener('scroll', positionMenu, true);
      window.removeEventListener('resize', positionMenu);
    };
  }, [open, positionMenu]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const flat = [...options, ...(groups ? groups.flatMap(g => g.options) : [])];
  const selected = flat.find(o => o.value === value);

  const buttonClass = [
    'inline-flex w-full items-center gap-2 border transition-colors cursor-pointer select-none text-left',
    dark
      ? 'bg-zinc-800 border-gray-600 text-gray-100 hover:bg-zinc-700'
      : 'bg-[#fdfdfe] border-gray-200 text-gray-700 hover:bg-zinc-100',
    size === 'xs' ? 'w-full' : '',
    SIZE_CLASSES[size],
  ].join(' ');

  const menuClass = [
    'fixed z-50 overflow-y-auto rounded-xl border p-1 shadow-lg',
    size === 'xs' ? 'max-h-40' : 'max-h-72',
    dark ? 'bg-zinc-800 border-gray-600' : 'bg-[#fdfdfe] border-gray-200',
  ].join(' ');

  return (
    <div ref={ref} className={`relative ${fullWidth ? 'w-full' : ''} ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={`${buttonClass} focus:outline-none focus-visible:ring-2 ${
          dark ? 'focus-visible:ring-white/30' : 'focus-visible:ring-gray-900/15'
        }`}
      >
        {leadingIcon && (
          <span className={`flex shrink-0 items-center self-stretch ${LEADING_MARGINS[size]}`}>
            <span className="flex-shrink-0">{leadingIcon}</span>
            <span className={`ml-2 w-px shrink-0 self-stretch ${dark ? 'bg-gray-600' : 'bg-gray-200'}`} />
          </span>
        )}
        {selected?.icon && <span className="flex-shrink-0">{selected.icon}</span>}
        <span className="flex-1 truncate">{selected ? selected.label : (placeholder ?? t('common.selectPlaceholder'))}</span>
        <span className="flex-shrink-0">
          <ChevronIcon />
        </span>
      </button>

      {open && (
        <div ref={menuRef} role="listbox" className={menuClass}>
          {options.map(o => renderOption(o))}
          {groups?.map(group => (
            <div key={group.label}>
              <p className={`px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider ${dark ? 'text-gray-400' : 'text-gray-400'}`}>
                {group.label}
              </p>
              {group.options.map(o => renderOption(o))}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  function renderOption(o: SelectOption) {
    return (
      <button
        key={o.value}
        type="button"
        role="option"
        aria-selected={o.value === value}
        disabled={o.disabled}
        onClick={() => {
          onChange(o.value);
          setOpen(false);
        }}
        className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm cursor-pointer transition-colors ${
          o.value === value
            ? dark
              ? 'bg-zinc-700 text-gray-100'
              : 'bg-zinc-100 text-gray-900'
            : dark
              ? 'text-gray-200 hover:bg-zinc-700'
              : 'text-gray-700 hover:bg-zinc-100'
        } ${o.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
      >
        {o.icon && <span className="flex-shrink-0">{o.icon}</span>}
        <span className="flex-1 truncate">{o.label}</span>
        {o.value === value && <CheckIcon />}
      </button>
    );
  }
}