import { useI18n } from '../../../lib/i18n';

export interface ScenarioSectionProps {
  title?: string;
  gridCols?: string;
  children: React.ReactNode;
}

export function ScenarioSection({ title, gridCols = 'grid grid-cols-1 min-[500px]:grid-cols-2 lg:grid-cols-4 gap-3', children }: Readonly<ScenarioSectionProps>) {
  const { t } = useI18n();
  return (
    <section className="space-y-3 -mx-6 sm:-mx-8 px-6 sm:px-8 border-t border-gray-200 pt-5 pb-5 first:border-t-0 first:pt-0">
      <h3 className="text-base font-bold text-gray-900 uppercase tracking-wider mb-3">{title ?? t('common.scenarioData')}</h3>
      <div className={gridCols}>{children}</div>
    </section>
  );
}
