import { createFileRoute } from '@tanstack/react-router';
import { FileExplorer } from '@renderer/components/FileExplorer';
import { RouteErrorBoundary } from '@renderer/components/ErrorBoundary';
import { useTranslation } from '@renderer/i18n';

export const Route = createFileRoute('/files/')({
  component: () => {
    // i18n pilot (#134): the error boundary's route label renders through the
    // catalog (`routes.files.title`), byte-identical to the old literal under en.
    const { t } = useTranslation();
    return (
      <RouteErrorBoundary routeName={t('routes.files.title')}>
        <FileExplorer />
      </RouteErrorBoundary>
    );
  },
  validateSearch: (search: Record<string, unknown>): { path: string; dialog?: 'problems' } => {
    return {
      path: typeof search.path === 'string' && search.path ? search.path : '/',
      dialog:
        typeof search.dialog === 'string' && search.dialog === 'problems'
          ? ('problems' as const)
          : undefined,
    };
  },
});
