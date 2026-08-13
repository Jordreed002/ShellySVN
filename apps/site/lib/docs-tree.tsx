import type * as PageTree from 'fumadocs-core/page-tree';
import { source } from './source';

/**
 * Post-processes the fumadocs page tree so the sidebar matches the site design:
 *
 *   · groups render flat and always open, as labelled sections rather than
 *     collapsible accordions — the tree is small enough to show whole;
 *   · pages whose frontmatter `status` is `preview` carry a chip, so a page
 *     describing gated behaviour is distinguishable at a glance.
 *
 * The frontmatter has always had `status`; nothing rendered it before.
 */
function statusFor(url: string): string | undefined {
  return source.getPages().find((page) => page.url === url)?.data.status;
}

function decorate(node: PageTree.Node): PageTree.Node {
  if (node.type === 'folder') {
    return {
      ...node,
      defaultOpen: true,
      collapsible: false,
      children: node.children.map(decorate),
    };
  }

  if (node.type === 'page' && statusFor(node.url) === 'preview') {
    return {
      ...node,
      name: (
        <>
          <span className="doc-nav-name">{node.name}</span>
          <span className="doc-nav-chip">preview</span>
        </>
      ),
    };
  }

  return node;
}

export function getDocsTree(): PageTree.Root {
  const tree = source.getPageTree();
  return { ...tree, children: tree.children.map(decorate) };
}
