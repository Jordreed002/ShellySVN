/**
 * Persistence for the tag wizard's recent name templates (#51).
 *
 * Follows the shortcutStore pattern: a versioned key on `window.api.store`,
 * parse functions that tolerate junk, and a cap on the list length so the
 * picker stays useful.
 */

export const TAG_TEMPLATES_KEY = 'shellysvn:tag-templates:v1';

export const MAX_RECENT_TAG_TEMPLATES = 8;

export interface RecentTagTemplate {
  template: string;
  usedAt: number;
}

/** Validate an unknown payload as the recent-template list; anything else is empty. */
export function parseRecentTagTemplates(value: unknown): RecentTagTemplate[] {
  if (!Array.isArray(value)) return [];
  const result: RecentTagTemplate[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { template, usedAt } = entry as { template?: unknown; usedAt?: unknown };
    if (typeof template !== 'string' || template.trim() === '') continue;
    result.push({
      template,
      usedAt: typeof usedAt === 'number' && Number.isFinite(usedAt) ? usedAt : 0,
    });
  }
  return dedupeRecentTemplates(result).slice(0, MAX_RECENT_TAG_TEMPLATES);
}

function dedupeRecentTemplates(list: RecentTagTemplate[]): RecentTagTemplate[] {
  const seen = new Set<string>();
  const result: RecentTagTemplate[] = [];
  for (const entry of list) {
    if (seen.has(entry.template)) continue;
    seen.add(entry.template);
    result.push(entry);
  }
  return result;
}

/** Record a use: most recent first, deduped, capped. */
export function recordRecentTagTemplate(
  list: readonly RecentTagTemplate[],
  template: string,
  usedAt: number = Date.now()
): RecentTagTemplate[] {
  const trimmed = template.trim();
  if (trimmed === '') return [...list];
  const next = [
    { template: trimmed, usedAt },
    ...list.filter((entry) => entry.template !== trimmed),
  ];
  return dedupeRecentTemplates(next).slice(0, MAX_RECENT_TAG_TEMPLATES);
}

/** Load persisted recent templates; storage failures degrade to empty. */
export async function loadRecentTagTemplates(): Promise<RecentTagTemplate[]> {
  try {
    const stored = await window.api?.store?.get<unknown>(TAG_TEMPLATES_KEY);
    if (stored === undefined || stored === null) return [];
    return parseRecentTagTemplates(stored);
  } catch {
    return [];
  }
}

/** Persist the list; callers decide how to surface failures. */
export async function saveRecentTagTemplates(list: readonly RecentTagTemplate[]): Promise<void> {
  await window.api?.store?.set(TAG_TEMPLATES_KEY, list);
}
