#!/usr/bin/env node

/**
 * ShellySVN CLI - Headless operation for automation
 * 
 * Usage:
 *   shellysvn-cli <command> [options] [arguments]
 * 
 * Commands:
 *   status <path>          Show working copy status
 *   update <path>          Update working copy
 *   commit <path>          Commit changes
 *   revert <path>          Revert local changes
 *   add <path>             Add files to version control
 *   info <path>            Show working copy info
 *   log <path>             Show commit history
 *   cleanup <path>         Cleanup working copy
 * 
 * Options:
 *   --json                 Output as JSON
 *   --quiet, -q            Suppress output
 *   --message, -m          Commit message
 *   --revision, -r         Revision number
 *   --help, -h             Show help
 *   --version, -v          Show version
 */

import { parseArgs } from 'node:util'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

// CLI argument types
interface CliOptions {
  json: boolean
  quiet: boolean
  message?: string
  revision?: string
  help: boolean
  version: boolean
}

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  dim: '\x1b[2m'
}

/**
 * Get path to logic engine binary
 */
function getEnginePath(): string {
  // In development, use the compiled engine
  const devPath = join(__dirname, '..', '..', 'packages', 'logic-engine', 'shelly-engine')
  
  // In production, use the bundled engine
  const prodPath = join(process.resourcesPath || '', 'binaries', 'shelly-engine')
  
  // Check if dev path exists
  if (existsSync(devPath)) {
    return devPath
  }
  
  return prodPath
}

/**
 * Execute logic engine command
 */
function execEngine(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const enginePath = getEnginePath()
    const proc = spawn(enginePath, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    
    let stdout = ''
    let stderr = ''
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(stderr || `Engine exited with code ${code}`))
      }
    })
    
    proc.on('error', (err) => {
      reject(err)
    })
  })
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
${colors.blue}ShellySVN CLI${colors.reset} - Headless operation for automation

${colors.yellow}Usage:${colors.reset}
  shellysvn-cli <command> [options] [arguments]

${colors.yellow}Commands:${colors.reset}
  status <path>          Show working copy status
  update <path>          Update working copy to HEAD
  commit <path>          Commit changes (requires -m)
  revert <path>          Revert local changes
  add <path>             Add files to version control
  delete <path>          Delete files from version control
  info <path>            Show working copy info
  log <path>             Show commit history
  cleanup <path>         Cleanup working copy

${colors.yellow}Options:${colors.reset}
  --json                 Output as JSON
  --quiet, -q            Suppress output
  --message, -m <msg>    Commit message
  --revision, -r <rev>   Revision number
  --help, -h             Show this help
  --version, -v          Show version

${colors.yellow}Examples:${colors.reset}
  shellysvn-cli status /path/to/checkout
  shellysvn-cli commit /path/to/checkout -m "Fix bug #123"
  shellysvn-cli update /path/to/checkout --json
  shellysvn-cli log /path/to/checkout -r 100:HEAD
`)
}

/**
 * Print version
 */
function printVersion(): void {
  console.log('ShellySVN CLI v0.1.0')
}

/**
 * Format output for display
 */
function formatOutput(data: unknown, asJson: boolean): string {
  if (asJson) {
    return JSON.stringify(data, null, 2)
  }
  
  if (typeof data === 'string') {
    return data
  }
  
  if (Array.isArray(data)) {
    return data.map(item => formatItem(item)).join('\n')
  }
  
  if (typeof data === 'object' && data !== null) {
    return formatItem(data)
  }
  
  return String(data)
}

/**
 * Format a single item for display
 */
function formatItem(item: unknown): string {
  if (typeof item !== 'object' || item === null) {
    return String(item)
  }
  
  const obj = item as Record<string, unknown>
  const lines: string[] = []
  
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      lines.push(`  ${colors.dim}${key}:${colors.reset} ${formatValue(value)}`)
    }
  }
  
  return lines.join('\n')
}

/**
 * Format a value for display
 */
function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return `${colors.blue}${value}${colors.reset}`
  }
  if (typeof value === 'boolean') {
    return value ? `${colors.green}true${colors.reset}` : `${colors.red}false${colors.reset}`
  }
  return String(value)
}

/**
 * Main CLI entry point
 */
export async function runCli(argv: string[]): Promise<number> {
  const args = argv.slice(2) // Remove 'node' and script path
  
  // Parse options
  const { values, positionals } = parseArgs({
    args,
    options: {
      json: { type: 'boolean', default: false },
      quiet: { type: 'boolean', short: 'q', default: false },
      message: { type: 'string', short: 'm' },
      revision: { type: 'string', short: 'r' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false }
    },
    strict: false
  })
  
  const options = values as CliOptions
  
  // Handle help and version
  if (options.help) {
    printHelp()
    return 0
  }
  
  if (options.version) {
    printVersion()
    return 0
  }
  
  // Get command
  const command = positionals[0]
  
  if (!command) {
    console.error(`${colors.red}Error:${colors.reset} No command specified`)
    printHelp()
    return 1
  }
  
  try {
    // Build engine arguments
    const engineArgs = ['svn', command]
    
    // Add message flag if provided
    if (options.message) {
      engineArgs.push('--message', options.message)
    }
    
    // Add path argument
    const path = positionals[1]
    if (path) {
      engineArgs.push(path)
    }
    
    // Execute engine
    const output = await execEngine(engineArgs)
    
    // Parse JSON output
    const data = JSON.parse(output)
    
    // Output result
    if (!options.quiet) {
      console.log(formatOutput(data, options.json))
    }
    
    return 0
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`${colors.red}Error:${colors.reset} ${message}`)
    
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: message }, null, 2))
    }
    
    return 1
  }
}

// Run CLI if executed directly
if (require.main === module) {
  runCli(process.argv)
    .then(exitCode => process.exit(exitCode))
    .catch(() => process.exit(1))
}

export default runCli
