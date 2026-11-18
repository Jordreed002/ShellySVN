/**
 * Platform-correct shortcut labels.
 *
 * Bindings are stored in the canonical `Ctrl+Shift+K` form (`shortcutStore`),
 * where `Ctrl` means "the primary modifier": ⌘ on macOS, Ctrl elsewhere. The
 * UI must say what the user will actually press, so a Windows or Linux user
 * never sees ⌘ and a Mac user never sees "Ctrl+".
 */

function readPlatform(): string {
  if (typeof navigator === 'undefined') return '';
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return (uaData?.platform || navigator.platform || '').toLowerCase();
}

export function isMacPlatform(platform: string = readPlatform()): boolean {
  return platform.toLowerCase().includes('mac');
}

const MAC_SYMBOL: Record<string, string> = {
  ctrl: '⌘',
  cmd: '⌘',
  meta: '⌘',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
};

const OTHER_LABEL: Record<string, string> = {
  ctrl: 'Ctrl',
  cmd: 'Ctrl',
  meta: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
};

/** Canonical `Ctrl+Shift+K` → `⇧⌘K` on macOS, `Ctrl+Shift+K` elsewhere. */
export function formatShortcut(canonical: string, mac: boolean = isMacPlatform()): string {
  const parts = canonical
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1).map((part) => part.toLowerCase());

  if (mac) {
    // macOS convention orders modifiers ⌃⌥⇧⌘ and joins them without separators.
    const order = ['alt', 'option', 'shift', 'ctrl', 'cmd', 'meta'];
    const symbols = modifiers
      .toSorted((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((modifier) => MAC_SYMBOL[modifier] ?? modifier);
    return `${symbols.join('')}${key.length === 1 ? key.toUpperCase() : key}`;
  }

  const labels = modifiers.map((modifier) => OTHER_LABEL[modifier] ?? modifier);
  return [...labels, key.length === 1 ? key.toUpperCase() : key].join('+');
}

/**
 * Display any shortcut label — canonical (`Ctrl+Shift+O`) or mac-symbol
 * (`⌘⇧O`, as some menus declare them) — in this platform's words. Labels
 * without a modifier (`↵`, `F5`, `Del`) pass through untouched.
 */
export function displayShortcut(label: string, mac: boolean = isMacPlatform()): string {
  if (!label) return label;
  const hasSymbol = /[⌘⇧⌥]/.test(label);
  const hasWord = /\b(ctrl|cmd|meta|alt|option|shift)\s*\+/i.test(label);
  if (!hasSymbol && !hasWord) return label;
  if (!hasSymbol) return formatShortcut(label, mac);
  const modifiers: string[] = [];
  if (label.includes('⌘')) modifiers.push('Ctrl');
  if (label.includes('⌥')) modifiers.push('Alt');
  if (label.includes('⇧')) modifiers.push('Shift');
  const key = label.replace(/[⌘⇧⌥+\s]/g, '');
  return formatShortcut([...modifiers, key].join('+'), mac);
}

/** `aria-keyshortcuts` value for a canonical binding on this platform. */
export function ariaShortcut(canonical: string, mac: boolean = isMacPlatform()): string {
  const parts = canonical.split('+').map((part) => part.trim());
  return parts
    .map((part, index) => {
      if (index === parts.length - 1) return part.length === 1 ? part.toUpperCase() : part;
      const lower = part.toLowerCase();
      if (lower === 'ctrl' || lower === 'cmd' || lower === 'meta') return mac ? 'Meta' : 'Control';
      if (lower === 'alt' || lower === 'option') return 'Alt';
      if (lower === 'shift') return 'Shift';
      return part;
    })
    .join('+');
}
