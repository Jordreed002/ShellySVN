import type { SvnListResult } from '@shared/types';
import { parseSvnListXml } from './parsers';
import { joinRepoUrl, normalizeRepoUrl } from '../utils/svn-url';

/** SVN emits decoded entry names; encode each child name exactly once. */
export function parseRepositoryListing(xml: string, rootUrl: string): SvnListResult {
  const canonicalRoot = normalizeRepoUrl(rootUrl);
  const parsed = parseSvnListXml(xml, canonicalRoot);
  const entries = parsed.entries.map((entry) => {
    const childUrl = joinRepoUrl(canonicalRoot, entry.name.replace(/\/+$/, ''));
    return { ...entry, path: childUrl, url: childUrl };
  });
  return { ...parsed, path: canonicalRoot, entries };
}
