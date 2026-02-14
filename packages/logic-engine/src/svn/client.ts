import { $ } from 'bun'
import { parseSvnStatusXml, parseSvnLogXml, parseSvnInfoXml } from './parser'
import type { SvnStatusResult, SvnLogResult, SvnInfoResult } from './types'

export class SvnClient {
  constructor(private svnPath: string) {}
  
  /**
   * Execute an SVN command and return the output
   */
  private async execute(args: string[], cwd?: string): Promise<string> {
    const fullArgs = [this.svnPath, ...args]
    const proc = Bun.spawn(fullArgs, {
      cwd: cwd || process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, LANG: 'en_US.UTF-8' }
    })
    
    const stdout = await proc.stdout.text()
    const stderr = await proc.stderr.text()
    const exitCode = await proc.exited
    
    if (exitCode !== 0) {
      throw new Error(stderr || `SVN command failed with exit code ${exitCode}`)
    }
    
    return stdout
  }
  
  /**
   * Get SVN status of a working copy
   */
  async status(path: string): Promise<SvnStatusResult> {
    const xml = await this.execute(['status', '--xml', path])
    return parseSvnStatusXml(xml, path)
  }
  
  /**
   * Get commit history
   */
  async log(
    path: string, 
    limit = 100, 
    startRevision?: number, 
    endRevision?: number
  ): Promise<SvnLogResult> {
    const args = ['log', '--xml', '--verbose', '-l', String(limit)]
    
    if (startRevision !== undefined && endRevision !== undefined) {
      args.push('-r', `${startRevision}:${endRevision}`)
    } else if (startRevision !== undefined) {
      args.push('-r', `${startRevision}:HEAD`)
    }
    
    args.push(path)
    const xml = await this.execute(args)
    return parseSvnLogXml(xml)
  }
  
  /**
   * Get working copy information
   */
  async info(path: string): Promise<SvnInfoResult> {
    const xml = await this.execute(['info', '--xml', path])
    return parseSvnInfoXml(xml)
  }
  
  /**
   * Update working copy
   */
  async update(path: string): Promise<{ success: boolean; revision: number }> {
    const xml = await this.execute(['update', '--xml', path])
    // Parse revision from update output
    const match = xml.match(/revision="(\d+)"/)
    const revision = match ? parseInt(match[1], 10) : 0
    return { success: true, revision }
  }
  
  /**
   * Commit changes
   */
  async commit(paths: string[], message: string): Promise<{ success: boolean; revision: number }> {
    const args = ['commit', '-m', message, ...paths]
    const output = await this.execute(args)
    // Parse revision from commit output
    const match = output.match(/Committed revision (\d+)\./)
    const revision = match ? parseInt(match[1], 10) : 0
    return { success: true, revision }
  }
  
  /**
   * Revert local changes
   */
  async revert(paths: string[]): Promise<{ success: boolean }> {
    await this.execute(['revert', ...paths])
    return { success: true }
  }
  
  /**
   * Add files to version control
   */
  async add(paths: string[]): Promise<{ success: boolean }> {
    await this.execute(['add', ...paths])
    return { success: true }
  }
  
  /**
   * Delete files from version control
   */
  async delete(paths: string[]): Promise<{ success: boolean }> {
    await this.execute(['delete', ...paths])
    return { success: true }
  }
  
  /**
   * Cleanup working copy
   */
  async cleanup(path: string): Promise<{ success: boolean }> {
    await this.execute(['cleanup', path])
    return { success: true }
  }
}
