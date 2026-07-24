export function handleNumericInputChange<T extends Record<string, unknown>>(
  field: keyof T,
  value: string | number,
  setParams: React.Dispatch<React.SetStateAction<T>>,
): void {
  const numericValue = typeof value === 'string' ? Number.parseFloat(value) || 0 : value;
  setParams(prev => ({ ...prev, [field]: numericValue }));
}
