import { app, dialog } from 'electron';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { writeSecureJson } from '../utils/secure-json';
import { externalToolPlaceholders, validateExternalToolTemplate } from './external-tool-template';

export type ExternalToolRole = 'editor' | 'diff' | 'merge';
export type ExternalToolArgument = string;

export interface ExternalToolSummary {
  id: string;
  name: string;
  roles: ExternalToolRole[];
  builtIn: boolean;
  available: boolean;
  argumentTemplate: ExternalToolArgument[];
}

interface StoredExternalTool extends ExternalToolSummary {
  executablePath: string;
}

interface RegistryFile {
  version: 1;
  tools: StoredExternalTool[];
}

const rejectedExecutables = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'dash',
  'cmd',
  'cmd.exe',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
  'wscript',
  'wscript.exe',
  'cscript',
  'cscript.exe',
  'node',
  'node.exe',
  'python',
  'python.exe',
  'python3',
  'perl',
  'perl.exe',
  'ruby',
  'ruby.exe',
]);
const rejectedExtensions = new Set([
  '.cmd',
  '.bat',
  '.ps1',
  '.vbs',
  '.js',
  '.mjs',
  '.cjs',
  '.py',
  '.pl',
  '.rb',
  '.sh',
]);
function defaultTemplate(role: ExternalToolRole): string[] {
  if (role === 'editor') return ['{path}'];
  if (role === 'diff') return ['{left}', '{right}'];
  return ['{base}', '{mine}', '{theirs}', '{merged}'];
}

async function validateExecutable(selectedPath: string): Promise<string> {
  const canonical = await realpath(selectedPath);
  const name = basename(canonical).toLowerCase();
  if (rejectedExecutables.has(name) || rejectedExtensions.has(extname(name))) {
    throw new Error('Command shells, interpreters, and scripts cannot be registered');
  }
  const stats = await stat(canonical);
  const isMacApp = process.platform === 'darwin' && stats.isDirectory() && name.endsWith('.app');
  if (!stats.isFile() && !isMacApp) throw new Error('Select an executable application');
  if (!isMacApp && process.platform !== 'win32') await access(canonical, constants.X_OK);
  if (process.platform !== 'win32' && (stats.mode & 0o002) !== 0) {
    throw new Error('World-writable executables cannot be registered');
  }
  return canonical;
}

class ExternalToolRegistry {
  private tools = new Map<string, StoredExternalTool>();
  private loaded = false;

  private get filePath(): string {
    return join(app.getPath('userData'), 'external-tools.json');
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as RegistryFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.tools)) return;
      for (const tool of parsed.tools) {
        try {
          tool.executablePath = await validateExecutable(tool.executablePath);
          tool.argumentTemplate = validateExternalToolTemplate(tool.roles, tool.argumentTemplate);
          this.tools.set(tool.id, tool);
        } catch {
          // Invalid legacy entries are deliberately quarantined.
        }
      }
    } catch {
      // First run.
    }
  }

  private async save(): Promise<void> {
    await writeSecureJson(this.filePath, {
      version: 1,
      tools: [...this.tools.values()],
    });
  }

  async list(): Promise<ExternalToolSummary[]> {
    await this.load();
    return [...this.tools.values()].map(({ executablePath: _, ...tool }) => ({
      ...tool,
    }));
  }

  async register(role: ExternalToolRole): Promise<ExternalToolSummary | null> {
    if (!externalToolPlaceholders[role]) throw new Error('Invalid external tool role');
    const result = await dialog.showOpenDialog({ properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const executablePath = await validateExecutable(result.filePaths[0]);
    const tool: StoredExternalTool = {
      id: `registered:${randomBytes(16).toString('hex')}`,
      name: basename(executablePath).replace(/\.app$/i, ''),
      roles: [role],
      builtIn: false,
      available: true,
      argumentTemplate: defaultTemplate(role),
      executablePath,
    };
    this.tools.set(tool.id, tool);
    await this.save();
    const { executablePath: _, ...summary } = tool;
    return summary;
  }

  async update(
    id: string,
    update: Partial<Pick<ExternalToolSummary, 'name' | 'roles' | 'argumentTemplate'>>
  ): Promise<ExternalToolSummary> {
    await this.load();
    const tool = this.tools.get(id);
    if (!tool) throw new Error('Unknown registered tool');
    const roles = update.roles ?? tool.roles;
    if (
      !Array.isArray(roles) ||
      roles.length === 0 ||
      roles.some((role) => !externalToolPlaceholders[role])
    ) {
      throw new Error('Invalid external tool roles');
    }
    const name = update.name === undefined ? tool.name : update.name.trim();
    if (!name || name.length > 100 || /\p{Cc}/u.test(name)) throw new Error('Invalid tool name');
    const argumentTemplate = validateExternalToolTemplate(
      roles,
      update.argumentTemplate ?? tool.argumentTemplate
    );
    Object.assign(tool, { name, roles: [...new Set(roles)], argumentTemplate });
    await this.save();
    const { executablePath: _, ...summary } = tool;
    return summary;
  }

  async remove(id: string): Promise<void> {
    await this.load();
    if (!this.tools.delete(id)) throw new Error('Unknown registered tool');
    await this.save();
  }

  async resolve(id: string, role: ExternalToolRole, values: Record<string, string>) {
    await this.load();
    const tool = this.tools.get(id);
    if (!tool || !tool.roles.includes(role))
      throw new Error('Tool is not registered for this action');
    const executablePath = await validateExecutable(tool.executablePath);
    const expanded = tool.argumentTemplate.map((token) =>
      token.replace(/\{[^}]+\}/g, (placeholder) => values[placeholder] ?? placeholder)
    );
    if (process.platform === 'darwin' && executablePath.toLowerCase().endsWith('.app')) {
      return {
        command: '/usr/bin/open',
        args: ['-a', executablePath, '--args', ...expanded],
      };
    }
    return { command: executablePath, args: expanded };
  }
}

let registry: ExternalToolRegistry | undefined;
export function getExternalToolRegistry(): ExternalToolRegistry {
  registry ??= new ExternalToolRegistry();
  return registry;
}
