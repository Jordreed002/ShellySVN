export function validateSvnTargets(targets: string[], label = 'SVN target'): void {
  if (targets.length === 0) throw new Error(`At least one ${label.toLowerCase()} is required`);
  for (const target of targets) {
    if (!target.trim()) throw new Error(`${label} must not be empty`);
    if (/[\u0000\r\n]/.test(target))
      throw new Error(`${label} contains invalid control characters`);
  }
}

export function escapeLocalPegTargets(targets: string[]): string[] {
  return targets.map((target) => {
    if (!target.includes('@') || target.endsWith('@')) return target;

    if (/^(?:https?|svn(?:\+ssh)?|file):\/\//i.test(target)) {
      const url = new URL(target);
      const hasExplicitPeg = /@(?:\d+|HEAD|BASE|COMMITTED|PREV|\{[^{}\r\n]+\})$/i.test(
        url.pathname
      );
      if (hasExplicitPeg) return target;
      if (!url.pathname.includes('@')) return target;
    }

    return `${target}@`;
  });
}

/** Append positional targets after SVN's option terminator. */
export function withSvnTargets(args: string[], targets: string[]): string[] {
  return [...args, '--', ...escapeLocalPegTargets(targets)];
}
