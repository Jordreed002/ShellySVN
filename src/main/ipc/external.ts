import { ipcMain, shell } from 'electron';
import { spawn } from 'child_process';
import { constants } from 'fs';
import { access, stat } from 'fs/promises';
import { normalize } from 'path';
import debug from '../utils/debug';
import { assertPathApprovedForIpc } from '../utils/approved-paths';
import { listCodeEditors, openInCodeEditor } from '../services/code-editors';

/**
 * SECURITY: Whitelist of allowed diff tools (known aliases)
 * Prevents arbitrary command execution via tool parameter
 */
const ALLOWED_DIFF_TOOLS: Record<
  string,
  { command: string; getArgs: (left: string, right: string) => string[] }
> = {
  bcompare: { command: 'bcompare', getArgs: (l, r) => [l, r] },
  bcomp: { command: 'bcomp', getArgs: (l, r) => [l, r] },
  meld: { command: 'meld', getArgs: (l, r) => [l, r] },
  kdiff3: { command: 'kdiff3', getArgs: (l, r) => [l, r] },
  diffmerge: { command: 'diffmerge', getArgs: (l, r) => [l, r] },
  p4merge: { command: 'p4merge', getArgs: (l, r) => [l, r] },
  tortoisediff: { command: 'TortoiseMerge', getArgs: (l, r) => ['/base:' + l, '/mine:' + r] },
  vscode: { command: 'code', getArgs: (l, r) => ['--diff', l, r] },
  code: { command: 'code', getArgs: (l, r) => ['--diff', l, r] },
};

/**
 * SECURITY: Whitelist of allowed merge tools
 */
const ALLOWED_MERGE_TOOLS: Record<
  string,
  {
    command: string;
    getArgs: (base: string, mine: string, theirs: string, merged: string) => string[];
  }
> = {
  bcompare: { command: 'bcompare', getArgs: (b, m, t, mg) => [m, t, b, mg] },
  bcomp: { command: 'bcomp', getArgs: (b, m, t, mg) => [m, t, b, mg] },
  meld: { command: 'meld', getArgs: (b, m, t, mg) => ['--diff', b, m, t, '--output', mg] },
  kdiff3: { command: 'kdiff3', getArgs: (b, m, t, mg) => [b, m, t, '-o', mg] },
  diffmerge: { command: 'diffmerge', getArgs: (b, m, t, mg) => ['-merge', '-result', mg, m, t, b] },
  p4merge: { command: 'p4merge', getArgs: (b, m, t, mg) => [b, t, m, mg] },
  tortoisemerge: {
    command: 'TortoiseMerge',
    getArgs: (b, m, t, mg) => ['/base:' + b, '/mine:' + m, '/theirs:' + t, '/merged:' + mg],
  },
};

function hasPathTraversal(path: string): boolean {
  return path.split(/[/\\]+/).includes('..');
}

/**
 * SECURITY: Validate that a path is a valid executable or script path
 * Allows custom tool paths while preventing security issues
 * PERFORMANCE: Uses async file operations
 */
async function validateToolPath(
  path: string
): Promise<{ valid: boolean; error?: string; normalized?: string }> {
  try {
    const normalized = normalize(path);

    // Check for path traversal attempts
    if (hasPathTraversal(path)) {
      return { valid: false, error: 'Path traversal not allowed' };
    }

    // Check that file exists and points to a file (async)
    let stats;
    try {
      await access(normalized);
      stats = await stat(normalized);
    } catch {
      return { valid: false, error: 'Tool executable does not exist' };
    }
    if (!stats.isFile()) {
      return { valid: false, error: 'Tool executable must be a file' };
    }
    if (process.platform !== 'win32') {
      try {
        await access(normalized, constants.X_OK);
      } catch {
        return { valid: false, error: 'Tool executable is not executable' };
      }
    }

    return { valid: true, normalized };
  } catch (error) {
    return { valid: false, error: (error as Error).message };
  }
}

/**
 * Validate that a path exists and is accessible
 * SECURITY: Prevents path traversal and access to sensitive files
 * PERFORMANCE: Uses async file operations
 */
async function validateFilePath(
  path: string
): Promise<{ valid: boolean; error?: string; normalized?: string }> {
  try {
    const normalized = normalize(path);

    // Check for path traversal attempts
    if (hasPathTraversal(path)) {
      return { valid: false, error: 'Path traversal not allowed' };
    }

    // Check that file exists and get stats (async)
    let stats;
    try {
      stats = await stat(normalized);
    } catch {
      return { valid: false, error: 'File does not exist' };
    }

    // Verify it's a file, not a directory
    if (!stats.isFile()) {
      return { valid: false, error: 'Path must be a file' };
    }

    return { valid: true, normalized };
  } catch (error) {
    return { valid: false, error: (error as Error).message };
  }
}

export function registerExternalHandlers(): void {
  // Open external diff tool
  ipcMain.handle('external:openDiffTool', async (_, tool: string, left: string, right: string) => {
    try {
      // SECURITY: Validate file paths first
      const leftValidation = await validateFilePath(left);
      if (!leftValidation.valid) {
        return { success: false, error: `Left file: ${leftValidation.error}` };
      }

      const rightValidation = await validateFilePath(right);
      if (!rightValidation.valid) {
        return { success: false, error: `Right file: ${rightValidation.error}` };
      }

      // Determine the actual command to use
      let command: string;
      let args: string[];

      // Check if tool is a known alias
      const toolConfig = ALLOWED_DIFF_TOOLS[tool.toLowerCase()];
      if (toolConfig) {
        command = toolConfig.command;
        args = toolConfig.getArgs(leftValidation.normalized!, rightValidation.normalized!);
      } else {
        // Treat tool as a custom path - validate it
        const toolPathValidation = await validateToolPath(tool);
        if (!toolPathValidation.valid) {
          return {
            success: false,
            error: `Unknown diff tool '${tool}' and custom path invalid: ${toolPathValidation.error}`,
          };
        }
        command = toolPathValidation.normalized!;
        args = [leftValidation.normalized!, rightValidation.normalized!];
      }

      debug.log(`[EXTERNAL] Launching diff tool: ${command}`);

      const proc = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });

      proc.unref();

      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Open external merge tool
  ipcMain.handle(
    'external:openMergeTool',
    async (_, tool: string, base: string, mine: string, theirs: string, merged: string) => {
      try {
        // SECURITY: Validate file paths (merged file doesn't need to exist)
        const baseValidation = await validateFilePath(base);
        if (!baseValidation.valid) {
          return { success: false, error: `Base file: ${baseValidation.error}` };
        }

        const mineValidation = await validateFilePath(mine);
        if (!mineValidation.valid) {
          return { success: false, error: `Mine file: ${mineValidation.error}` };
        }

        const theirsValidation = await validateFilePath(theirs);
        if (!theirsValidation.valid) {
          return { success: false, error: `Theirs file: ${theirsValidation.error}` };
        }

        // Normalize merged path (file may not exist yet)
        const mergedNormalized = normalize(merged);
        if (hasPathTraversal(merged)) {
          return { success: false, error: 'Path traversal not allowed in merged file path' };
        }

        // Determine the actual command to use
        let command: string;
        let args: string[];

        // Check if tool is a known alias
        const toolConfig = ALLOWED_MERGE_TOOLS[tool.toLowerCase()];
        if (toolConfig) {
          command = toolConfig.command;
          args = toolConfig.getArgs(
            baseValidation.normalized!,
            mineValidation.normalized!,
            theirsValidation.normalized!,
            mergedNormalized
          );
        } else {
          // Treat tool as a custom path - validate it
          const toolPathValidation = await validateToolPath(tool);
          if (!toolPathValidation.valid) {
            return {
              success: false,
              error: `Unknown merge tool '${tool}' and custom path invalid: ${toolPathValidation.error}`,
            };
          }
          command = toolPathValidation.normalized!;
          // Default args for custom tools: base mine theirs merged
          args = [
            baseValidation.normalized!,
            mineValidation.normalized!,
            theirsValidation.normalized!,
            mergedNormalized,
          ];
        }

        debug.log(`[EXTERNAL] Launching merge tool: ${command}`);

        const proc = spawn(command, args, {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });

        proc.unref();

        return { success: true };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }
  );

  // Open folder in file explorer
  ipcMain.handle('external:openFolder', async (_, path: string) => {
    try {
      if (hasPathTraversal(path)) {
        return { success: false, error: 'Path traversal not allowed' };
      }
      const normalized = assertPathApprovedForIpc(path, 'Opening local folders');

      let stats;
      try {
        stats = await stat(normalized);
      } catch {
        return { success: false, error: 'Folder does not exist' };
      }
      if (!stats.isDirectory()) {
        return { success: false, error: 'Path must be a folder' };
      }

      const openError = await shell.openPath(normalized);
      if (openError) {
        return { success: false, error: openError };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Open file with default application
  ipcMain.handle('external:openFile', async (_, path: string) => {
    try {
      assertPathApprovedForIpc(path, 'Opening local files');
      // SECURITY: Validate path
      const validation = await validateFilePath(path);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const openError = await shell.openPath(validation.normalized!);
      if (openError) {
        return { success: false, error: openError };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Open directories and reveal files in Finder/Explorer.
  ipcMain.handle('external:revealPath', async (_, path: string) => {
    try {
      if (hasPathTraversal(path)) {
        return { success: false, error: 'Path traversal not allowed' };
      }
      const normalized = assertPathApprovedForIpc(path, 'Revealing local files');

      let stats;
      try {
        stats = await stat(normalized);
      } catch {
        return { success: false, error: 'Path does not exist' };
      }

      if (stats.isDirectory()) {
        const openError = await shell.openPath(normalized);
        return openError ? { success: false, error: openError } : { success: true };
      }

      shell.showItemInFolder(normalized);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Editors installed on this machine, for the "Open in…" menu.
  ipcMain.handle('external:listEditors', async (_, refresh?: boolean) =>
    listCodeEditors({ refresh: refresh === true })
  );

  // Open a file or folder in one of them. The renderer names an editor by id;
  // the command it maps to is fixed in the main process.
  ipcMain.handle('external:openInEditor', async (_, editorId: string, path: string) => {
    try {
      if (hasPathTraversal(path)) {
        return { success: false, error: 'Path traversal not allowed' };
      }
      const normalized = assertPathApprovedForIpc(path, 'Opening paths in an editor');

      try {
        await stat(normalized);
      } catch {
        return { success: false, error: 'Path does not exist' };
      }

      return await openInCodeEditor(editorId, normalized);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
