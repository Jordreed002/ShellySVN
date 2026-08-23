/**
 * Pure model for property-conflict resolution (#56).
 *
 * A property conflict means: at least one property's working value, incoming
 * value, and common-ancestor value disagree. SVN records the clash with
 * `name.*.prej` reject files, but the *values* themselves come from the
 * property IPC (`svn proplist` / `svn propget` at WORKING vs BASE) plus the
 * reject artifacts when present. Everything here is pure; the panel component
 * does the IPC.
 */

export interface PropertySides {
  name: string;
  /** Common-ancestor value (empty string = property absent there). */
  base: string;
  /** Working-copy (your) value. `undefined` = property not set locally. */
  mine: string | undefined;
  /** Incoming value. `undefined` = not fetchable / not set. */
  theirs: string | undefined;
  /** Where the "theirs" value came from, for honest labeling. */
  theirsSource: 'artifact' | 'repository-head' | 'unavailable';
}

export type PropertyChoice = 'mine' | 'theirs' | 'base' | 'custom';

export interface PropertyResolution {
  name: string;
  choice: PropertyChoice;
  /** Final value to apply; empty string means "remove the property". */
  value: string;
}

/**
 * Parse property names out of a `.prej` reject file. SVN writes lines like
 * `Conflict for property 'svn:eol-style' detected` (older clients) or headers
 * naming the property before each value block; both shapes are covered by
 * scanning for quoted or colon-suffixed property names.
 */
export function parsePrejPropertyNames(prejContent: string): string[] {
  const names = new Set<string>();
  const quoted = /['"]([A-Za-z0-9_:.-]+)['"]/g;
  for (const match of prejContent.matchAll(quoted)) {
    if (match[1].includes(':')) names.add(match[1]);
  }
  const colonHeaders = /^([A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+)\s*$/gm;
  for (const match of prejContent.matchAll(colonHeaders)) {
    names.add(match[1]);
  }
  return [...names];
}

/**
 * Derive the conflicted property names from a working-vs-BASE property list
 * diff: any property whose value differs, or that exists on only one side,
 * took part in the conflict.
 */
export function findConflictedPropertyNames(
  working: Readonly<Record<string, string>>,
  base: Readonly<Record<string, string>>
): string[] {
  const names = new Set([...Object.keys(working), ...Object.keys(base)]);
  return [...names]
    .filter((name) => working[name] !== base[name])
    .toSorted((a, b) => a.localeCompare(b));
}

/** Assemble the mine/theirs/base presentation for one property. */
export function resolvePropertySides(
  name: string,
  values: {
    base?: string;
    mine?: string;
    theirs?: string;
    theirsSource?: PropertySides['theirsSource'];
  }
): PropertySides {
  return {
    name,
    base: values.base ?? '',
    mine: values.mine,
    theirs: values.theirs,
    theirsSource: values.theirsSource ?? (values.theirs !== undefined ? 'repository-head' : 'unavailable'),
  };
}

/** The value a choice stands for, falling back sensibly when a side is missing. */
export function valueForChoice(sides: PropertySides, choice: PropertyChoice): string {
  switch (choice) {
    case 'mine':
      return sides.mine ?? '';
    case 'theirs':
      return sides.theirs ?? '';
    case 'base':
      return sides.base;
    case 'custom':
      return '';
  }
}

/**
 * Decide the apply action for one resolved property: `set` writes the value
 * (including overwriting with an edited custom result), `del` removes it —
 * chosen when the final value is empty (an empty property value is
 * semantically a removal for SVN, so mirror that instead of storing "").
 */
export function planPropertyApply(
  resolution: PropertyResolution
): { action: 'set' | 'del'; value: string } {
  if (resolution.value === '') {
    return { action: 'del', value: '' };
  }
  return { action: 'set', value: resolution.value };
}

/**
 * The per-property confirmation line for the final review: what the user
 * picked and what will happen, in one plain sentence.
 */
export function describePropertyResolution(resolution: PropertyResolution): string {
  const name = resolution.name;
  switch (resolution.choice) {
    case 'mine':
      return `${name}: keep your value`;
    case 'theirs':
      return `${name}: take the incoming value`;
    case 'base':
      return `${name}: restore the BASE value`;
    case 'custom':
      return resolution.value === ''
        ? `${name}: remove the property`
        : `${name}: apply the merged value`;
  }
}

/**
 * Initial merged suggestion: when both sides changed the same property from
 * base, start from your value (the working copy is what survives without
 * action); when only theirs changed it, start from theirs so nothing is lost
 * silently.
 */
export function suggestMergedValue(sides: PropertySides): string {
  const mineChanged = sides.mine !== undefined && sides.mine !== sides.base;
  if (mineChanged) return sides.mine ?? '';
  return sides.theirs ?? sides.base;
}
