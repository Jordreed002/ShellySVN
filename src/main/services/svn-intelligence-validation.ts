import { assertPathApprovedForIpc } from '../utils/approved-paths';
import { validateSvnTargets } from '../utils/svn-targets';
import { fileURLToPath } from 'node:url';

const ALLOWED_REPOSITORY_PROTOCOLS = new Set(['https:', 'http:', 'svn:', 'svn+ssh:', 'file:']);
const MAX_REPOSITORY_URL_LENGTH = 8 * 1024;

export function validateRepositoryUrl(value: string, label: string): string {
  if (typeof value !== 'string' || value.length > MAX_REPOSITORY_URL_LENGTH) {
    throw new Error(`${label} must be a bounded SVN repository URL.`);
  }
  validateSvnTargets([value], label);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute SVN repository URL.`);
  }
  if (!ALLOWED_REPOSITORY_PROTOCOLS.has(url.protocol) || !url.pathname) {
    throw new Error(`${label} uses an unsupported repository URL.`);
  }
  if (url.username || url.password) throw new Error(`${label} must not contain credentials.`);
  if (url.hash) throw new Error(`${label} must not contain a URL fragment.`);
  if (url.protocol === 'file:') {
    if (url.host && url.host !== 'localhost') {
      throw new Error(`${label} must not use a remote file URL.`);
    }
    assertPathApprovedForIpc(fileURLToPath(url), label);
  }
  return url.toString();
}

export function validateRepositoryTarget(value: string, label: string): string {
  return /^(?:https?|svn(?:\+ssh)?|file):\/\//i.test(value)
    ? validateRepositoryUrl(value, label)
    : assertPathApprovedForIpc(value, label);
}
