import { useState } from 'react';
import { localeOf, useI18n } from '../../../lib/i18n';
import { BANKS, type BankId, type ExpenseSplit, type Movement } from '../../../lib/bankImports';
import { formatCurrency, formatSigned } from '../../../lib/calculations';
import { EXPENSE_CATEGORY_LIST, expenseSplits } from '../../../lib/investments';
import { InputField } from '../form/InputField';
import { Select } from '../form/Select';
import { Tooltip } from '../info/Tooltip';
import { Icon } from '../Icons';
import { BankLogo } from './BankLogo';
import { ExpenseCategoryIcon } from './CategoryIcon';

const BANK_LABELS: Record<BankId, string> = Object.fromEntries(
  BANKS.map(b => [b.id, b.label]),
) as Record<BankId, string>;

/** Fecha corta estilo Whisper: «14 ene» en lugar del locale completo. */
function cardDate(date: string, lang: 'es' | 'en' | 'fr'): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(localeOf(lang), { day: 'numeric', month: 'short', year: 'numeric' });
}

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

/** Indicador de propiedad (conjunto/individual) + selector de la propiedad. */
function PropertySelect({
  value,
  categoryJoint,
  label,
  onChange,
}: {
  value: 'joint' | 'individual' | 'auto';
  /** Propiedad de la categoría actual, para el icono de «Según categoría». */
  categoryJoint: boolean;
  label: string;
  onChange: (value: 'joint' | 'individual' | 'auto') => void;
}) {
  const { t } = useI18n();
  return (
    <Select
      value={value}
      size="xs"
      ariaLabel={label}
      className="w-[158px]"
      onChange={v => onChange(v as 'joint' | 'individual' | 'auto')}
      options={[
        { value: 'auto', label: t('common.accordingToCategory'), icon: <span className="inline-flex h-[19px] w-[19px] items-center justify-center"><Icon name={categoryJoint ? 'users' : 'user'} className="h-4 w-4 text-gray-500" /></span> },
        { value: 'joint', label: t('common.joint'), icon: <span className="inline-flex h-[19px] w-[19px] items-center justify-center"><Icon name="users" className="h-4 w-4 text-gray-500" /></span> },
        { value: 'individual', label: t('common.individual'), icon: <span className="inline-flex h-[19px] w-[19px] items-center justify-center"><Icon name="user" className="h-4 w-4 text-gray-500" /></span> },
      ]}
    />
  );
}

export interface ExpenseCardListProps {
  movements: Movement[];
  jointCategories: readonly string[];
  selected: Set<string>;
  /** `true` cuando todos los movimientos visibles están seleccionados. */
  allSelected: boolean;
  onToggleOne: (id: string) => void;
  onToggleAll: () => void;
  onChangeCategory: (id: string, category: string) => void;
  onSaveExpenseSplits: (id: string, splits: ExpenseSplit[]) => void;
  onChangeChargeType: (id: string, targetValue: 'joint' | 'individual' | 'auto') => void;
}

/** Lista de gastos como tarjetas (estilo Whisper Money): icono de categoría a
 *  la izquierda, concepto + fecha, importe a la derecha junto al banco y, si
 *  el gasto está repartido, sus partes con categoría, propiedad e importe. */
export function ExpenseCardList({
  movements,
  jointCategories,
  selected,
  allSelected,
  onToggleOne,
  onToggleAll,
  onChangeCategory,
  onSaveExpenseSplits,
  onChangeChargeType,
}: Readonly<ExpenseCardListProps>) {
  const { t, lang, tCategory } = useI18n();
  const [editingSplit, setEditingSplit] = useState<{ movement: Movement; splits: ExpenseSplit[] } | null>(null);

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between px-1">
        <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-gray-600 transition-colors hover:text-gray-900">
          <input
            type="checkbox"
            aria-label={t('common.selectAllVisible')}
            checked={allSelected}
            onChange={onToggleAll}
            className="h-4 w-4 cursor-pointer accent-gray-900"
          />
          <span>
            {t('common.selectVisible')}
            <span className="text-gray-400">
              {' '}{t('common.expenseCount', { n: movements.length, s: movements.length === 1 ? '' : 's' })}
            </span>
          </span>
        </label>
      </div>
      <ul className="space-y-2.5">
        {movements.map(m => {
          const category = m.category ?? 'Otros';
          const isRefund = m.type === 'refund';
          const savedSplits = m.expenseSplits ?? [];
          const hasSavedSplit = savedSplits.length > 1;
          const isEditingSplit = editingSplit?.movement.id === m.id;
          const displayedSplits = isEditingSplit ? editingSplit.splits : savedSplits;
          const categoryIsJoint = jointCategories.includes(category);
          const isOverridden = m.isJointAuto === false && m.isJoint !== undefined;
          const selectValue: 'joint' | 'individual' | 'auto' = isOverridden
            ? m.isJoint
              ? 'joint'
              : 'individual'
            : 'auto';
          const isChecked = selected.has(m.id);
          const hasSplitArea = isEditingSplit || hasSavedSplit;

          const total = displayedSplits.reduce(
            (sum, split) => sum + (Number.isFinite(split.amount) ? split.amount : 0),
            0,
          );
          const expected = Math.abs(m.amount);
          const valid =
            displayedSplits.length > 1 &&
            displayedSplits.every(
              split => split.category && Number.isFinite(split.amount) && split.amount > 0,
            ) &&
            Math.abs(total - expected) < 0.005;

          const updateSplit = (index: number, patch: Partial<ExpenseSplit>) => {
            setEditingSplit(current =>
              current
                ? {
                    ...current,
                    splits: current.splits.map((split, splitIndex) =>
                      splitIndex === index ? { ...split, ...patch } : split,
                    ),
                  }
                : current,
            );
          };

          return (
            <li key={m.id}>
              <div
                className={`overflow-hidden rounded-2xl border bg-[#fdfdfe] transition-colors ${
                  isChecked
                    ? 'border-gray-400/70 ring-1 ring-gray-400/20'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start gap-3 px-4 pb-2 pt-3 sm:items-center">
                  <input
                    type="checkbox"
                    aria-label={t('common.selectConcept', { concept: m.concept })}
                    checked={isChecked}
                    onChange={() => onToggleOne(m.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-gray-900 sm:mt-0"
                  />
                  <span className="min-[480px]:hidden">
                    <ExpenseCategoryIcon category={category} size={16} />
                  </span>
                  <span className="hidden min-[480px]:inline-flex">
                    <ExpenseCategoryIcon category={category} size={18} />
                  </span>
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <Tooltip text={m.concept} className="block w-full min-w-0 cursor-pointer">
                      <p className="line-clamp-2 break-words text-sm font-semibold leading-snug text-gray-900 md:line-clamp-1">{m.concept}</p>
                    </Tooltip>
                    <p className="mt-0.5 text-xs leading-3 text-gray-500">{cardDate(m.date, lang)}</p>
                  </div>
                  <div className="relative z-10 flex shrink-0 items-center gap-1.5">
                    <div className="flex shrink-0 items-center gap-2.5">
                      <span className={`text-sm font-semibold ${isRefund ? 'text-emerald-600' : 'text-red-600'}`}>
                        {formatSigned(m.amount)}
                      </span>
                      <span className="flex items-center gap-1.5 text-sm text-gray-400">
                        <span className="min-[480px]:hidden">
                          <BankLogo bank={m.bank} size={14} />
                        </span>
                        <span className="hidden min-[480px]:inline-flex">
                          <BankLogo bank={m.bank} size={16} />
                        </span>
                        <span className="hidden min-[480px]:inline">{BANK_LABELS[m.bank]}</span>
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={isEditingSplit ? t('common.closeSplitOf', { concept: m.concept }) : t('common.splitConcept', { concept: m.concept })}
                      onClick={() =>
                        setEditingSplit(current =>
                          current?.movement.id === m.id
                            ? null
                            : { movement: m, splits: expenseSplits(m).map(split => ({ ...split })) },
                        )
                      }
                      className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors ${
                        isEditingSplit
                          ? 'bg-zinc-200 text-gray-900'
                          : 'text-gray-500 hover:bg-zinc-100 hover:text-gray-900'
                      }`}
                    >
                      <Icon name="split" className="h-3 w-3 shrink-0" />
                    </button>
                  </div>
                </div>

                {!hasSplitArea && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-4 py-2.5">
                    <Select
                      value={category}
                      size="xs"
                      ariaLabel={t('common.categoryOf', { concept: m.concept })}
                      className="w-[158px]"
                      onChange={v => onChangeCategory(m.id, v)}
                      options={EXPENSE_CATEGORY_LIST.map(c => ({
                        value: c,
                        label: tCategory(c),
                        icon: <ExpenseCategoryIcon category={c} size={11} />,
                      }))}
                    />
                    <PropertySelect
                      value={selectValue}
                      categoryJoint={categoryIsJoint}
                      label={t('common.ownershipOf', { concept: m.concept })}
                      onChange={v => onChangeChargeType(m.id, v)}
                    />
                  </div>
                )}

                {hasSplitArea && (
                  <div className={`border-t border-gray-100 px-4 pb-2 pt-1.5 ${isEditingSplit ? 'bg-zinc-50/70' : ''}`}>
                    <ul className="ml-7 space-y-1 border-l border-gray-200/80 pl-3">
                      {displayedSplits.map((split, index) => {
                        return (
                          <li key={index} className="relative flex flex-wrap items-center gap-x-2.5 gap-y-1.5 py-1">
                            {isEditingSplit && index === displayedSplits.length - 1 && (
                              <button
                                type="button"
                                aria-label={t('common.addPart')}
                                onClick={() =>
                                  setEditingSplit(current =>
                                    current
                                      ? { ...current, splits: [...current.splits, { category: current.splits[0]?.category ?? m.category ?? 'Otros', amount: 0 }] }
                                      : current,
                                  )
                                }
                                className="group absolute -left-[43px] top-1/2 flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center p-0"
                              >
                                <svg
                                  width="20"
                                  height="20"
                                  viewBox="0 0 20 20"
                                  fill="none"
                                  className="block"
                                  aria-hidden="true"
                                >
                                  <circle
                                    cx="10"
                                    cy="10"
                                    r="9.4"
                                    fill="#fdfdfe"
                                    stroke="currentColor"
                                    strokeWidth="1.2"
                                    className="text-gray-300 transition-colors group-hover:text-gray-400"
                                  />
                                  <path
                                    d="M10 6.8v6.4M6.8 10h6.4"
                                    stroke="currentColor"
                                    strokeWidth="1.2"
                                    strokeLinecap="round"
                                    className="text-gray-500"
                                  />
                                </svg>
                              </button>
                            )}
                            <Select
                              value={split.category}
                              size="xs"
                              ariaLabel={t('common.categoryOfPart', { n: index + 1 })}
                              className="w-[158px]"
                              onChange={v => {
                                if (isEditingSplit) updateSplit(index, { category: v });
                                else
                                  onSaveExpenseSplits(
                                    m.id,
                                    displayedSplits.map((part, partIndex) =>
                                      partIndex === index ? { ...part, category: v } : part,
                                    ),
                                  );
                              }}
                              options={EXPENSE_CATEGORY_LIST.map(c => ({
                                value: c,
                                label: tCategory(c),
                                icon: <ExpenseCategoryIcon category={c} size={11} />,
                              }))}
                            />
                            <PropertySelect
                              value={split.isJoint === undefined ? 'auto' : split.isJoint ? 'joint' : 'individual'}
                              categoryJoint={jointCategories.includes(split.category)}
                              label={t('common.ownershipOfPart', { n: index + 1 })}
                              onChange={property => {
                                const isJointValue = property === 'auto' ? undefined : property === 'joint';
                                if (isEditingSplit) updateSplit(index, { isJoint: isJointValue });
                                else
                                  onSaveExpenseSplits(
                                    m.id,
                                    displayedSplits.map((part, partIndex) =>
                                      partIndex === index ? { ...part, isJoint: isJointValue } : part,
                                    ),
                                  );
                              }}
                            />
                            <div className="flex items-center gap-x-2.5">
                              {isEditingSplit ? (
                                <InputField
                                  value={String(split.amount)}
                                  onChange={raw =>
                                    updateSplit(index, { amount: Number.parseFloat(raw.replace(',', '.')) })
                                  }
                                  min={0.01}
                                  step="1"
                                  ariaLabel={t('common.amountOfPart', { n: index + 1 })}
                                  className="w-28"
                                  inputClassName="pr-8 py-1 px-2 text-right rounded-md"
                                  stepperRound="md"
                                />
                              ) : (
                                <span className={`text-sm font-semibold ${isRefund ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {formatSigned(isRefund ? split.amount : -split.amount)}
                                </span>
                              )}
                              {isEditingSplit && (
                                <button
                                  type="button"
                                  aria-label={t('common.removePart', { n: index + 1 })}
                                  disabled={displayedSplits.length === 1}
                                  onClick={() =>
                                    setEditingSplit(current =>
                                      current
                                        ? { ...current, splits: current.splits.filter((_, splitIndex) => splitIndex !== index) }
                                        : current,
                                    )
                                  }
                                  className="cursor-pointer rounded p-1 text-gray-400 transition-colors hover:text-red-600 disabled:cursor-not-allowed disabled:text-gray-300"
                                >
                                  <TrashIcon />
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {isEditingSplit && (
                  <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 px-4 py-2.5 max-[521px]:flex-col max-[521px]:items-stretch">
                    <span className={`text-xs font-semibold ${valid ? 'text-emerald-700' : 'text-red-600'}`}>
                      {t('common.splitProgress', { total: formatCurrency(total), expected: formatCurrency(expected) })}
                    </span>
                    <div className="flex-1 max-[521px]:hidden" />
                    <div className="flex items-center gap-3 max-[521px]:w-full max-[521px]:justify-end">
                      <button
                        type="button"
                        disabled={!valid}
                        onClick={() => {
                          onSaveExpenseSplits(m.id, displayedSplits);
                          setEditingSplit(null);
                        }}
                        className="cursor-pointer rounded-xl border border-gray-200 bg-zinc-100 px-2 py-1 text-xs min-[480px]:text-sm font-semibold text-gray-900 transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {t('common.save')}
                      </button>
                      {hasSavedSplit && (
                        <button
                          type="button"
                          onClick={() => {
                            onSaveExpenseSplits(m.id, []);
                            setEditingSplit(null);
                          }}
                          className="cursor-pointer rounded-xl border border-gray-200 hover:bg-zinc-100 px-2 py-1 text-xs min-[480px]:text-sm font-semibold text-gray-900 transition-colors"
                        >
                          {t('common.removeSplit')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}