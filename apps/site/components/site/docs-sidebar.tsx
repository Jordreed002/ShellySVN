'use client';

import type * as PageTree from 'fumadocs-core/page-tree';
import type { ReactNode } from 'react';

/**
 * Renders a folder in the docs sidebar as a labelled section rather than a
 * collapsible accordion. The tree is already marked non-collapsible in
 * lib/docs-tree.tsx; this supplies the mono uppercase group label the design
 * uses, without depending on fumadocs' internal utility classes.
 */
export function DocsSidebarFolder({
  item,
  children,
}: {
  item: PageTree.Folder;
  children: ReactNode;
}) {
  return (
    <div className="doc-nav-group">
      <p className="doc-nav-label">{item.name}</p>
      {children}
    </div>
  );
}
