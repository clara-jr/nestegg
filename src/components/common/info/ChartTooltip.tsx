import React from 'react';
import { useI18n } from '../../../lib/i18n';

interface TooltipPayloadEntry {
  dataKey: string;
  value: number;
  color: string;
  payload: Record<string, unknown>;
}

export interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  renderContent?: (payload: TooltipPayloadEntry[]) => React.ReactNode;
}

const TOOLTIP_STYLE = {
  backgroundColor: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '8px 12px',
  fontSize: '12px',
  fontFamily: 'var(--font-sans)',
} as const;

export function ChartTooltip({ active, payload, renderContent }: Readonly<ChartTooltipProps>) {
  const { t } = useI18n();
  if (!active || !payload?.length) return null;

  return (
    <div style={TOOLTIP_STYLE}>
      {renderContent
        ? renderContent(payload)
        : payload.map((entry, i) => (
            <p key={i} style={{ color: entry.color, marginBottom: i < payload.length - 1 ? 2 : 0 }}>
              {entry.dataKey === 'total' ? t('common.tooltipTotal') : entry.dataKey === 'minimumTotal' ? t('common.tooltipMinimum') : ''}{entry.value}
            </p>
          ))
      }
    </div>
  );
}
