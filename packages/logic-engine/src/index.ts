#!/usr/bin/env bun
/**
 * ShellySVN Logic Engine
 * 
 * A compiled Bun binary that handles SVN operations.
 * Communicates with the Electron app via stdout (JSON responses).
 * 
 * Usage:
 *   shelly-engine svn status --json /path/to/repo
 *   shelly-engine svn log --json --limit 50 /path/to/repo
 */

import { SvnClient } from './svn/client'
import { getBinaryPath } from './utils/paths'

// Parse command line arguments
const args = process.argv.slice(2)
const command = args[0]
const subCommand = args[1]

// Initialize SVN client with path to bundled SVN binary
const svnPath = getBinaryPath('svn')
const svnClient = new SvnClient(svnPath)

/**
 * Parse flags and arguments from command line
 */
function parseArgs(args: string[]): { flags: Record<string, string | boolean>; positional: string[] } {
  const flags: Record<string, string | boolean> = {}
  const positional: string[] = []
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const nextArg = args[i + 1]
      if (nextArg && !nextArg.startsWith('-')) {
        flags[key] = nextArg
        i++
      } else {
        flags[key] = true
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1)
      flags[key] = true
    } else {
      positional.push(arg)
    }
  }
  
  return { flags, positional }
}

/**
 * Output JSON result to stdout
 */
function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}

/**
 * Output error and exit with non-zero code
 */
function outputError(message: string, code = 1): never {
  console.error(JSON.stringify({ error: true, message }))
  process.exit(code)
}

/**
 * Main command router
 */
async function main(): Promise<void> {
  try {
    if (!command) {
      outputError('No command provided. Usage: shelly-engine <command> [args]')
    }
    
    switch (command) {
      case 'svn': {
        if (!subCommand) {
          outputError('No SVN subcommand provided')
        }
        
        const { flags, positional } = parseArgs(args.slice(2))
        
        switch (subCommand) {
          case 'status': {
            const path = positional[0] || process.cwd()
            const result = await svnClient.status(path)
            outputJson(result)
            break
          }
          
          case 'log': {
            const path = positional[0] || process.cwd()
            const limit = typeof flags.limit === 'string' ? parseInt(flags.limit, 10) : 100
            const startRev = typeof flags['start-revision'] === 'string' 
              ? parseInt(flags['start-revision'], 10) 
              : undefined
            const endRev = typeof flags['end-revision'] === 'string' 
              ? parseInt(flags['end-revision'], 10) 
              : undefined
            const result = await svnClient.log(path, limit, startRev, endRev)
            outputJson(result)
            break
          }
          
          case 'info': {
            const path = positional[0] || process.cwd()
            const result = await svnClient.info(path)
            outputJson(result)
            break
          }
          
          case 'update': {
            const path = positional[0] || process.cwd()
            const result = await svnClient.update(path)
            outputJson(result)
            break
          }
          
          case 'commit': {
            const paths = positional.length > 0 ? positional : [process.cwd()]
            const message = typeof flags.message === 'string' ? flags.message : ''
            if (!message) {
              outputError('Commit message is required (--message)')
            }
            const result = await svnClient.commit(paths, message)
            outputJson(result)
            break
          }
          
          case 'revert': {
            const paths = positional.length > 0 ? positional : [process.cwd()]
            const result = await svnClient.revert(paths)
            outputJson(result)
            break
          }
          
          case 'add': {
            const paths = positional
            if (paths.length === 0) {
              outputError('No paths specified for add')
            }
            const result = await svnClient.add(paths)
            outputJson(result)
            break
          }
          
          case 'delete': {
            const paths = positional
            if (paths.length === 0) {
              outputError('No paths specified for delete')
            }
            const result = await svnClient.delete(paths)
            outputJson(result)
            break
          }
          
          case 'cleanup': {
            const path = positional[0] || process.cwd()
            const result = await svnClient.cleanup(path)
            outputJson(result)
            break
          }
          
          default:
            outputError(`Unknown SVN subcommand: ${subCommand}`)
        }
        break
      }
      
      case '--version':
      case '-v':
        outputJson({ version: '0.1.0', name: 'ShellySVN Logic Engine' })
        break
      
      case '--help':
      case '-h':
        console.log(`
ShellySVN Logic Engine

Usage:
  shelly-engine svn <command> [options] [path]

Commands:
  status    Get SVN status of a working copy
  log       Get commit history
  info      Get working copy information
  update    Update working copy
  commit    Commit changes (--message required)
  revert    Revert local changes
  add       Add files to version control
  delete    Delete files from version control
  cleanup   Cleanup working copy

Options:
  --json    Output in JSON format (default)
  --limit   Limit number of results (for log)
  --message Commit message (for commit)

Examples:
  shelly-engine svn status --json /path/to/repo
  shelly-engine svn log --limit 50 /path/to/repo
  shelly-engine svn commit --message "Initial commit" /path/to/file
`)
        break
      
      default:
        outputError(`Unknown command: ${command}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    outputError(message)
  }
}

main()
