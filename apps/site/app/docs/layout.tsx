import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsSidebarFolder } from '@/components/site/docs-sidebar';
import { ReleaseStrip } from '@/components/site/release-strip';
import { SiteFooter } from '@/components/site/site-footer';
import { getDocsTree } from '@/lib/docs-tree';
import { baseOptions } from '@/lib/layout.shared';

/**
 * Docs share the marketing chrome — the same release strip above the nav and
 * the same footer below the article — so the two halves of the site do not
 * read as different products.
 */
export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <div className="site-shell">
      <ReleaseStrip />
      <DocsLayout
        tree={getDocsTree()}
        sidebar={{ collapsible: false, components: { Folder: DocsSidebarFolder } }}
        {...baseOptions()}
      >
        {children}
      </DocsLayout>
      <div className="wrap">
        <SiteFooter />
      </div>
    </div>
  );
}
