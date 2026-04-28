import type { SvnStatusChar } from '@shared/types';

export interface CommitPathAutocompleteOption {
  value: string;
  label: string;
  description: string;
  category: string;
}

export function buildPathAutocompleteOptions(
  message: string,
  files: Array<{ path: string; status: SvnStatusChar }>
): CommitPathAutocompleteOption[] {
  const messageKey = message.toLowerCase();

  return files
    .filter((file) => !messageKey.includes(file.path.toLowerCase()))
    .slice(0, 8)
    .map((file) => ({
      value: appendPathReference(message, file.path),
      label: file.path,
      description: `${getStatusLabel(file.status)} path`,
      category: 'Changed Paths',
    }));
}

export function appendPathReference(message: string, path: string): string {
  if (!message.trim()) return path;
  if (/\s$/.test(message)) return message + path;
  return `${message} ${path}`;
}

function getStatusLabel(status: SvnStatusChar): string {
  switch (status) {
    case 'A':
      return 'Added';
    case 'D':
      return 'Deleted';
    case 'M':
      return 'Modified';
    case 'R':
      return 'Replaced';
    case '?':
      return 'Unversioned';
    default:
      return 'Changed';
  }
}
