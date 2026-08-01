import type { ExternalToolRole } from './external-tool-registry';

export const externalToolPlaceholders: Record<ExternalToolRole, Set<string>> = {
  editor: new Set(['{path}']),
  diff: new Set(['{left}', '{right}']),
  merge: new Set(['{base}', '{mine}', '{theirs}', '{merged}']),
};

export function validateExternalToolTemplate(
  roles: ExternalToolRole[],
  template: unknown
): string[] {
  if (!Array.isArray(template) || template.length === 0 || template.length > 64) {
    throw new Error('Invalid external tool argument template');
  }
  const allowed = new Set(roles.flatMap((role) => [...externalToolPlaceholders[role]]));
  return template.map((token) => {
    if (typeof token !== 'string' || token.length === 0 || token.length > 1024) {
      throw new Error('Invalid external tool argument');
    }
    if (
      /[$`;&|<>\r\n]/.test(token) ||
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(token) ||
      token.startsWith('@')
    ) {
      throw new Error('Shell syntax is not allowed in external tool arguments');
    }
    for (const match of token.matchAll(/\{[^}]+\}/g)) {
      if (!allowed.has(match[0])) throw new Error(`Unsupported placeholder ${match[0]}`);
    }
    return token;
  });
}
