/**
 * "Open in <editor>" for files and folders.
 *
 * Editors are found by looking for their launcher on `PATH` — the same thing a
 * terminal would find — so the menu only ever offers editors that are actually
 * installed and actually launchable. Nothing is inferred from an app bundle or a
 * registry key: if `code` is not on `PATH`, VS Code is not offered, because
 * running it would fail.
 *
 * The launcher is chosen from a fixed table rather than taken from the renderer:
 * an id from the UI can only ever select one of these commands, never supply one.
 */

import { spawn, spawnSync } from 'child_process';
import { constants } from 'fs';
import { access } from 'fs/promises';
import { homedir } from 'os';
import { delimiter, join } from 'path';

import type { CustomOpenWithTool } from '@shared/types';
import { getSettingsManager } from '../settings-manager';
import { debug } from '../utils/debug';

export interface CodeEditorDefinition {
  id: string;
  label: string;
  /** Launcher to look for on `PATH`. */
  command: string;
  /**
   * Terminal-only editors are deliberately absent: spawned from a GUI app they
   * would open invisibly, which reads as "the menu item does nothing".
   */
  args?: readonly string[];
}

/** Ordered by how likely they are to be the one you meant. */
const KNOWN_EDITORS: readonly CodeEditorDefinition[] = [
  { id: 'vscode', label: 'VS Code', command: 'code' },
  { id: 'vscode-insiders', label: 'VS Code Insiders', command: 'code-insiders' },
  { id: 'vscodium', label: 'VSCodium', command: 'codium' },
  { id: 'cursor', label: 'Cursor', command: 'cursor' },
  { id: 'windsurf', label: 'Windsurf', command: 'windsurf' },
  { id: 'zed', label: 'Zed', command: 'zed' },
  { id: 'sublime', label: 'Sublime Text', command: 'subl' },
  { id: 'textmate', label: 'TextMate', command: 'mate' },
  { id: 'bbedit', label: 'BBEdit', command: 'bbedit' },
  { id: 'nova', label: 'Nova', command: 'nova' },
  { id: 'intellij', label: 'IntelliJ IDEA', command: 'idea' },
  { id: 'webstorm', label: 'WebStorm', command: 'webstorm' },
  { id: 'pycharm', label: 'PyCharm', command: 'pycharm' },
  { id: 'phpstorm', label: 'PhpStorm', command: 'phpstorm' },
  { id: 'rider', label: 'Rider', command: 'rider' },
  { id: 'clion', label: 'CLion', command: 'clion' },
  { id: 'goland', label: 'GoLand', command: 'goland' },
];

const EDITORS_BY_ID = new Map(KNOWN_EDITORS.map((editor) => [editor.id, editor]));

/** What the menu needs to know: which editors exist, and what to call them. */
export interface AvailableCodeEditor {
  id: string;
  label: string;
  /** Resolved launcher, shown in the item's tooltip so the action is inspectable. */
  command: string;
  /** Whether this entry suits files, folders, or both. Detected editors take both. */
  appliesTo?: 'files' | 'folders' | 'both';
  /** True for an application the user added in Settings. */
  custom?: boolean;
}

/**
 * Windows resolves `code` to `code.cmd`; everywhere else the file must simply be
 * executable. `PATHEXT` is consulted rather than assumed so an unusual setup
 * (say `.bat` only) still resolves.
 */
function candidateNames(command: string): string[] {
  if (process.platform !== 'win32') return [command];
  const extensions = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean);
  return [command, ...extensions.map((extension) => `${command}${extension.toLowerCase()}`)];
}

/**
 * The PATH to search — which is emphatically **not** just `process.env.PATH`.
 *
 * An Electron app launched from Finder or the dock inherits the launchd
 * environment, not your shell's: on macOS that is usually
 * `/usr/bin:/bin:/usr/sbin:/sbin`, so a `code` shim in `/usr/local/bin` or a
 * Homebrew binary in `/opt/homebrew/bin` is invisible and every editor looks
 * uninstalled. So the login shell is asked what *it* has, and the places editors
 * are actually installed are added as a backstop.
 */
function wellKnownDirectories(): string[] {
  if (wellKnownOverride) return wellKnownOverride;
  if (process.platform === 'win32') return [];

  const home = homedir();
  return [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/local/bin',
    join(home, '.local', 'bin'),
    join(home, 'bin'),
    // JetBrains Toolbox writes its `idea`/`webstorm` shims here.
    process.platform === 'darwin'
      ? join(home, 'Library', 'Application Support', 'JetBrains', 'Toolbox', 'scripts')
      : join(home, '.local', 'share', 'JetBrains', 'Toolbox', 'scripts'),
  ];
}

function searchDirectories(): string[] {
  const directories = (process.env.PATH ?? '').split(delimiter).filter(Boolean);

  if (process.platform !== 'win32') {
    directories.push(...loginShellPath(), ...wellKnownDirectories());
  }

  // First hit wins, so keep the original order while dropping repeats.
  return Array.from(new Set(directories));
}

let cachedLoginShellPath: string[] | null = null;
/**
 * Test seam. Detection reaches into real system directories by design, which
 * would otherwise make a test's answer depend on what is installed on the
 * machine running it.
 */
let wellKnownOverride: string[] | null = null;

/**
 * `$SHELL -ilc 'printf %s "$PATH"'` — an interactive login shell, because that is
 * what sources the profile that puts editors on PATH in the first place. Best
 * effort and time-boxed: a shell that hangs must not hold up a context menu.
 */
function loginShellPath(): string[] {
  if (cachedLoginShellPath) return cachedLoginShellPath;

  const shell = process.env.SHELL;
  if (!shell) {
    cachedLoginShellPath = [];
    return cachedLoginShellPath;
  }

  try {
    const result = spawnSync(shell, ['-ilc', 'printf %s "$PATH"'], {
      encoding: 'utf8',
      timeout: 3000,
      // A profile that prompts must not block; it just gets no input.
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    cachedLoginShellPath = (result.stdout ?? '').trim().split(delimiter).filter(Boolean);
  } catch (error) {
    debug.warn('[Editors] Could not read the login shell PATH:', error);
    cachedLoginShellPath = [];
  }
  return cachedLoginShellPath;
}

async function resolveOnPath(command: string): Promise<string | null> {
  const directories = searchDirectories();
  for (const directory of directories) {
    for (const name of candidateNames(command)) {
      const candidate = join(directory, name);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Not here, or not executable — keep looking.
      }
    }
  }
  return null;
}

/** Prefix that marks an id as coming from settings rather than the fixed table. */
const CUSTOM_PREFIX = 'custom:';

function customTools(): CustomOpenWithTool[] {
  try {
    return getSettingsManager().get('customOpenWithTools') ?? [];
  } catch (error) {
    // Settings unavailable (very early startup, or no Electron app): the built-in
    // editors still work, so this is a degradation and not a failure.
    debug.warn('[Editors] Could not read custom applications:', error);
    return [];
  }
}

/**
 * Split an arguments template into argv, honouring quotes and substituting the
 * target path for `{path}`. Without a `{path}` the path is appended, which is
 * what nearly every launcher wants.
 */
export function buildCustomArgs(template: string | undefined, targetPath: string): string[] {
  const pattern = (template ?? '').trim();
  if (!pattern) return [targetPath];

  const tokens = pattern.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const argv = tokens.map((token) =>
    token.replace(/^["']|["']$/g, '').replace(/\{path\}/g, targetPath)
  );
  return argv.some((argument) => argument.includes(targetPath)) ? argv : [...argv, targetPath];
}

let cachedEditors: Promise<AvailableCodeEditor[]> | null = null;
/** Absolute launcher per editor id, so launching never re-resolves a PATH. */
const resolvedLaunchers = new Map<string, string>();

async function detectPathEditors(): Promise<AvailableCodeEditor[]> {
  const found = await Promise.all(
    KNOWN_EDITORS.map(async (editor) => {
      const resolved = await resolveOnPath(editor.command);
      if (!resolved) return null;
      resolvedLaunchers.set(editor.id, resolved);
      return { id: editor.id, label: editor.label, command: editor.command };
    })
  );
  const available = found.filter((editor): editor is AvailableCodeEditor => editor !== null);

  debug.log(
    `[Editors] Searched ${searchDirectories().length} directories; found: ${
      available.map((editor) => resolvedLaunchers.get(editor.id)).join(', ') || 'none'
    }`
  );
  return available;
}

/**
 * Editors installed on this machine. Cached for the session: a few dozen `access`
 * calls is cheap once, but not on every right-click. `refresh` re-probes for
 * someone who has just installed one.
 */
export async function listCodeEditors(
  options: { refresh?: boolean } = {}
): Promise<AvailableCodeEditor[]> {
  if (options.refresh || !cachedEditors) {
    cachedEditors = detectPathEditors().catch((error) => {
      debug.error('[Editors] Detection failed:', error);
      cachedEditors = null;
      return [];
    });
  }

  /*
   * The PATH scan is cached; the user's own entries are not, so adding one in
   * Settings takes effect immediately. They are always offered even when the
   * command looks wrong: they typed it, so a mistake should surface as a launch
   * error naming the command rather than a row that quietly never appears —
   * which is indistinguishable from the feature being broken.
   */
  const custom = customTools().flatMap((tool) => {
    const name = tool.name?.trim();
    const command = tool.command?.trim();
    if (!name || !command) return [];
    return [
      {
        id: `${CUSTOM_PREFIX}${tool.id}`,
        label: name,
        command,
        appliesTo: tool.appliesTo ?? ('both' as const),
        custom: true,
      },
    ];
  });

  return [...(await cachedEditors), ...custom];
}

/** Test seam: forget what was detected, including the login-shell PATH. */
export function resetCodeEditorCacheForTests(): void {
  cachedEditors = null;
  cachedLoginShellPath = null;
  resolvedLaunchers.clear();
}

/** Test seam: replace the well-known install directories (`null` restores them). */
export function setEditorSearchDirectoriesForTests(directories: string[] | null): void {
  wellKnownOverride = directories;
}

interface ResolvedLaunch {
  launcher?: string;
  args?: string[];
  label?: string;
  error?: string;
}

/**
 * Turn an id into a command line. Built-in ids map through the fixed table;
 * `custom:<id>` ids are looked up in settings, where the user typed them. Either
 * way the renderer only ever names an entry — it cannot supply a command.
 */
async function resolveLaunch(editorId: string, targetPath: string): Promise<ResolvedLaunch> {
  if (editorId.startsWith(CUSTOM_PREFIX)) {
    const tool = customTools().find((candidate) => `${CUSTOM_PREFIX}${candidate.id}` === editorId);
    if (!tool) {
      return { error: 'That application is no longer configured in Settings.' };
    }

    const command = tool.command.trim();
    /*
     * On macOS a `.app` is a directory, not something to exec: `open -a` is how
     * you launch one, and it takes the target after `--args`-free positional
     * form. Anything else is treated as a launcher to resolve.
     */
    if (process.platform === 'darwin' && command.toLowerCase().endsWith('.app')) {
      return { launcher: '/usr/bin/open', args: ['-a', command, targetPath], label: tool.name };
    }

    const resolved = command.includes('/') || command.includes('\\')
      ? command
      : ((await resolveOnPath(command)) ?? command);
    return {
      launcher: resolved,
      args: buildCustomArgs(tool.arguments, targetPath),
      label: tool.name,
    };
  }

  const editor = EDITORS_BY_ID.get(editorId);
  if (!editor) {
    return { error: `Unknown editor: ${editorId}` };
  }

  const available = await listCodeEditors();
  if (!available.some((candidate) => candidate.id === editorId)) {
    return { error: `${editor.label} was not found on this machine.` };
  }

  return {
    // The absolute launcher found during detection, so a GUI-launched app does
    // not have to resolve `code` against a PATH that never had it.
    launcher: resolvedLaunchers.get(editorId) ?? editor.command,
    args: [...(editor.args ?? []), targetPath],
    label: editor.label,
  };
}

/**
 * Launch an editor on a path. Detached and with its streams ignored, so closing
 * ShellySVN does not take the editor with it and a chatty launcher cannot fill a
 * pipe nobody reads.
 */
export async function openInCodeEditor(
  editorId: string,
  targetPath: string
): Promise<{ success: boolean; error?: string }> {
  const { launcher, args, error } = await resolveLaunch(editorId, targetPath);
  if (error) return { success: false, error };

  return new Promise((resolve) => {
    try {
      const child = spawn(launcher!, args!, {
        detached: true,
        stdio: 'ignore',
        // `code` and friends are `.cmd` shims on Windows, which need a shell.
        shell: process.platform === 'win32',
        // Editors shell out to node, git and their own tooling; hand them a PATH
        // that has those on it rather than launchd's four directories.
        env: { ...process.env, PATH: searchDirectories().join(delimiter) },
      });
      child.once('error', (error) => {
        resolve({ success: false, error: error.message });
      });
      child.once('spawn', () => {
        child.unref();
        resolve({ success: true });
      });
    } catch (error) {
      resolve({ success: false, error: (error as Error).message });
    }
  });
}
