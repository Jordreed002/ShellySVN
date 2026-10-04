/**
 * Main-side consumer of `AppSettings.externalToolTemplates` (#87 / Track A
 * coordination item 10).
 *
 * Turns a stored `ExternalToolTemplateConfig` into a launched process:
 * validates the template with the shared per-kind rules, expands the
 * placeholders (shared code — identical to the settings-UI preview), resolves
 * and checks the executable, and spawns it detached.
 *
 * SECURITY:
 * - No shell interpolation anywhere: the executable is spawned with an argv
 *   array and `shell: false`, so expanded arguments can never be re-parsed
 *   as shell syntax. (On Windows, Node refuses .bat/.cmd targets without a
 *   shell, so script launchers fail closed at spawn.)
 * - The executable path comes from user settings (chosen via the native file
 *   picker) — that is the accepted trust boundary; it is verified to exist
 *   and point at a file before spawning.
 * - The child inherits no environment beyond the default process env and no
 *   file descriptors (stdio ignored); nothing sensitive is logged.
 */

import { spawn } from 'child_process';
import { realpath, stat } from 'fs/promises';
import { basename } from 'path';
import type { ExternalToolTemplateConfig, SvnMutationResult } from '@shared/types';
import {
  expandArgumentTemplate,
  extractPlaceholders,
  validateArgumentTemplate,
  type PlaceholderValues,
} from '@shared/external-tool-templates';
import { getSettingsManager } from '../settings-manager';
import debug from '../utils/debug';

/** Structured error codes, mirroring the SvnMutationResult errorCode pattern. */
export type ExternalTemplateLaunchErrorCode =
  | 'TOOL_CONFIG_INVALID'
  | 'TEMPLATE_INVALID'
  | 'PLACEHOLDER_UNRESOLVED'
  | 'EXECUTABLE_NOT_FOUND'
  | 'SPAWN_FAILED';

export type ExternalTemplateLaunchResult = SvnMutationResult;

function launchFailure(
  errorCode: ExternalTemplateLaunchErrorCode,
  error: string
): ExternalTemplateLaunchResult {
  return { success: false, error, errorCode };
}

/** Defensive shape check — stored settings are parsed JSON, never trusted. */
function isTemplateConfig(value: unknown): value is ExternalToolTemplateConfig {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ExternalToolTemplateConfig>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.executablePath === 'string' &&
    typeof candidate.argumentTemplate === 'string' &&
    (candidate.kind === 'diff' || candidate.kind === 'merge')
  );
}

/**
 * Find a stored template tool by id and kind. Returns undefined when the id
 * is not a configured template (caller falls through to alias/registry
 * resolution) or when settings are unavailable — never throws.
 */
export async function findSettingsToolTemplate(
  id: string,
  kind: ExternalToolTemplateConfig['kind']
): Promise<ExternalToolTemplateConfig | undefined> {
  try {
    const manager = getSettingsManager();
    await manager.ready();
    const tools = manager.getSettings().externalToolTemplates ?? [];
    const match = tools.find((tool) => isTemplateConfig(tool) && tool.id === id && tool.kind === kind);
    return match;
  } catch (error) {
    debug.warn('[EXTERNAL] Settings unavailable while resolving tool template:', (error as Error).message);
    return undefined;
  }
}

/** Verify the configured executable exists and is a file (or macOS .app bundle). */
async function resolveExecutable(executablePath: string): Promise<string | null> {
  try {
    const canonical = await realpath(executablePath);
    const stats = await stat(canonical);
    const isMacApp = process.platform === 'darwin' && stats.isDirectory() && basename(canonical).toLowerCase().endsWith('.app');
    if (!stats.isFile() && !isMacApp) return null;
    return canonical;
  } catch {
    return null;
  }
}

/**
 * Spawn detached and wait until the process has actually started (or failed).
 * The 'spawn' event only fires after the OS has created the process, so an
 * ENOENT/EACCES surfaces here as a rejection instead of a silent success.
 */
function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function launchTemplateTool(
  tool: ExternalToolTemplateConfig,
  values: PlaceholderValues
): Promise<ExternalTemplateLaunchResult> {
  const executable = tool.executablePath?.trim();
  if (!executable) {
    return launchFailure(
      'TOOL_CONFIG_INVALID',
      `Tool "${tool.name || tool.id}" has no executable path configured.`
    );
  }

  const template = tool.argumentTemplate ?? '';
  const validation = validateArgumentTemplate(tool.kind, template);
  if (!validation.valid) {
    return launchFailure(
      'TEMPLATE_INVALID',
      `Tool "${tool.name || tool.id}" has an invalid argument template: ${validation.errors.join(' ')}`
    );
  }

  const args = expandArgumentTemplate(template, values);

  // Placeholders the launcher has no value for (e.g. a merge template using
  // {base} when no base revision exists) must not reach the tool literally.
  const unresolved = [...new Set(args.flatMap((arg) => extractPlaceholders(arg)))];
  if (unresolved.length > 0) {
    return launchFailure(
      'PLACEHOLDER_UNRESOLVED',
      `Unresolved placeholder${unresolved.length > 1 ? 's' : ''} ${unresolved
        .map((token) => `{${token}}`)
        .join(', ')} in the argument template for "${tool.name || tool.id}".`
    );
  }

  const executableResolved = await resolveExecutable(executable);
  if (!executableResolved) {
    debug.warn(`[EXTERNAL] Configured executable not found: ${executable}`);
    return launchFailure(
      'EXECUTABLE_NOT_FOUND',
      `The configured executable could not be found: ${executable}`
    );
  }

  try {
    await spawnDetached(executableResolved, args);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    debug.warn(
      `[EXTERNAL] Failed to launch template tool "${tool.name || tool.id}":`,
      code ?? (error as Error).message
    );
    return launchFailure(
      'SPAWN_FAILED',
      code === 'ENOENT'
        ? `The configured executable could not be started: ${executableResolved}`
        : `Failed to launch "${tool.name || tool.id}": ${(error as Error).message}`
    );
  }

  debug.log(`[EXTERNAL] Launched ${tool.kind} template tool "${tool.name || tool.id}"`);
  return { success: true };
}

/** Launch a stored diff tool template ({mine}/{left} = left, {theirs}/{right} = right). */
export function launchDiffToolTemplate(
  tool: ExternalToolTemplateConfig,
  paths: { left: string; right: string }
): Promise<ExternalTemplateLaunchResult> {
  return launchTemplateTool(tool, {
    mine: paths.left,
    left: paths.left,
    theirs: paths.right,
    right: paths.right,
  });
}

/** Launch a stored merge tool template ({base}/{mine}/{theirs}/{merged}). */
export function launchMergeToolTemplate(
  tool: ExternalToolTemplateConfig,
  paths: { base: string; mine: string; theirs: string; merged: string }
): Promise<ExternalTemplateLaunchResult> {
  return launchTemplateTool(tool, paths);
}
