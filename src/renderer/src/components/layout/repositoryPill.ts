/** What the top bar may truthfully say about the active repository. */
export interface RepositoryPill {
  label: string;
  host: string | null;
  ariaLabel: string;
  title: string;
}

export interface RepositoryPillFacts {
  repositoryRoot?: string;
  workingCopyPath?: string;
  browsedUrl?: string;
  knownRoots?: readonly { url: string; name: string }[];
}

/** Host portion of an SVN URL. Null for local paths and file URLs. */
export function repositoryHost(url: string | undefined): string | null {
  if (!url) return null;
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)/i.exec(url);
  return match ? match[1] : null;
}

/** Trailing segment of a filesystem path. */
export function pathTail(value: string): string {
  return (
    value
      .replace(/[/\\]+$/, '')
      .split(/[/\\]/)
      .filter(Boolean)
      .pop() || value
  );
}

function repositoryName(rootUrl: string): string | null {
  const path = rootUrl.replace(/[?#].*$/, '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  const segments = path.split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

function isWithinRepository(root: string, url: string): boolean {
  const base = root.replace(/\/+$/, '');
  const target = url.replace(/\/+$/, '');
  return base.length > 0 && (target === base || target.startsWith(`${base}/`));
}

export function describeRepositoryPill({
  repositoryRoot,
  workingCopyPath,
  browsedUrl,
  knownRoots = [],
}: RepositoryPillFacts): RepositoryPill {
  const root =
    repositoryRoot ??
    knownRoots.find((candidate) => !!browsedUrl && isWithinRepository(candidate.url, browsedUrl))
      ?.url;

  if (root) {
    const name = repositoryName(root);
    const host = repositoryHost(root);
    const label = name ?? host;
    if (label) {
      return {
        label,
        host: name ? host : null,
        ariaLabel: `Repository ${label}${name && host ? ` on ${host}` : ''} — switch repository`,
        title: workingCopyPath ? `${root} — ${workingCopyPath}` : root,
      };
    }
  }

  if (browsedUrl) {
    const host = repositoryHost(browsedUrl);
    if (host) {
      return {
        label: host,
        host: null,
        ariaLabel: `Browsing a repository on ${host} — switch repository`,
        title: browsedUrl,
      };
    }
  }

  if (workingCopyPath) {
    const folder = pathTail(workingCopyPath);
    return {
      label: folder,
      host: null,
      ariaLabel: `Working copy ${folder} — switch repository`,
      title: workingCopyPath,
    };
  }

  return {
    label: 'No repository',
    host: null,
    ariaLabel: 'No repository open — open the command palette to pick one',
    title: 'No repository open',
  };
}
