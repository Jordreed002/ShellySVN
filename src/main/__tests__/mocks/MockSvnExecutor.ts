/**
 * MockSvnExecutor - Mock implementation of SVN command execution for unit testing
 *
 * This class provides a controllable mock for testing SVN operations without
 * requiring an actual SVN installation or repository.
 */

import type { SvnExecutionContext } from '@shared/types'

export interface MockSvnResponse {
  stdout: string
  stderr?: string
  exitCode?: number
  error?: Error
}

export type MockSvnHandler = (args: string[], cwd?: string) => MockSvnResponse | Promise<MockSvnResponse>

export interface MockSvnConfig {
  /** Default responses for specific SVN commands */
  responses?: Map<string, MockSvnResponse>
  /** Custom handler for complex scenarios */
  handler?: MockSvnHandler
  /** Default timeout in seconds (0 = no timeout) */
  defaultTimeout?: number
  /** Whether to log commands for debugging */
  debug?: boolean
}

/**
 * Mock SVN executor that simulates SVN command execution
 *
 * @example
 * ```ts
 * const mock = new MockSvnExecutor()
 * mock.setResponse('status', { stdout: '<?xml version="1.0"?><status>...</status>' })
 *
 * // Use in tests
 * const result = await mock.execute(['status', '--xml', '/path/to/wc'])
 * ```
 */
export class MockSvnExecutor {
  private responses: Map<string, MockSvnResponse> = new Map()
  private customHandler?: MockSvnHandler
  private callHistory: Array<{ args: string[]; cwd?: string; timestamp: number }> = []
  private debug: boolean = false
  private defaultTimeout: number = 0

  constructor(config?: MockSvnConfig) {
    if (config?.responses) {
      this.responses = config.responses
    }
    this.customHandler = config?.handler
    this.debug = config?.debug ?? false
    this.defaultTimeout = config?.defaultTimeout ?? 0
  }

  /**
   * Set a response for a specific SVN command
   * @param command The SVN command (e.g., 'status', 'log', 'info')
   * @param response The mock response
   */
  setResponse(command: string, response: MockSvnResponse): void {
    this.responses.set(command, response)
  }

  /**
   * Set multiple responses at once
   */
  setResponses(responses: Record<string, MockSvnResponse>): void {
    for (const [command, response] of Object.entries(responses)) {
      this.responses.set(command, response)
    }
  }

  /**
   * Set a custom handler for dynamic responses
   */
  setHandler(handler: MockSvnHandler): void {
    this.customHandler = handler
  }

  /**
   * Execute a mock SVN command
   * This mimics the behavior of the real executeSvn function
   */
  async execute(args: string[], cwd?: string, _context?: Partial<SvnExecutionContext>): Promise<string> {
    // Record call for assertions
    this.callHistory.push({
      args: [...args],
      cwd,
      timestamp: Date.now()
    })

    if (this.debug) {
      console.log(`[MockSvn] Executing: svn ${args.join(' ')} in ${cwd || process.cwd()}`)
    }

    // Simulate timeout if configured
    if (this.defaultTimeout > 0) {
      await new Promise(resolve => setTimeout(resolve, Math.min(this.defaultTimeout * 100, 100)))
    }

    // Get the command (first non-flag argument after any config options)
    const command = this.extractCommand(args)

    // Use custom handler if provided
    if (this.customHandler) {
      const response = await this.customHandler(args, cwd)
      return this.processResponse(response, command)
    }

    // Look up predefined response
    const response = this.responses.get(command)
    if (response) {
      return this.processResponse(response, command)
    }

    // Default response based on command
    return this.getDefaultResponse(command)
  }

  /**
   * Extract the SVN command from args array
   */
  private extractCommand(args: string[]): string {
    // Skip config options
    for (const arg of args) {
      if (!arg.startsWith('-') && !arg.startsWith('--')) {
        // Check for compound commands like 'changelist:add'
        const nextIndex = args.indexOf(arg) + 1
        if (nextIndex < args.length && !args[nextIndex].startsWith('-')) {
          // This might be a subcommand or argument
          return arg
        }
        return arg
      }
    }
    return 'unknown'
  }

  /**
   * Process a mock response and return or throw appropriately
   */
  private processResponse(response: MockSvnResponse, _command: string): string {
    if (response.error) {
      throw response.error
    }

    if (response.exitCode !== undefined && response.exitCode !== 0) {
      throw new Error(response.stderr || `SVN exited with code ${response.exitCode}`)
    }

    return response.stdout
  }

  /**
   * Get a default response for commands without predefined responses
   */
  private getDefaultResponse(command: string): string {
    switch (command) {
      case 'status':
        return this.defaultStatusXml()
      case 'info':
        return this.defaultInfoXml()
      case 'log':
        return this.defaultLogXml()
      case 'list':
        return this.defaultListXml()
      case 'diff':
        return this.defaultDiffOutput()
      case 'update':
        return 'Updated to revision 1234.\n'
      case 'commit':
        return 'Committed revision 1235.\n'
      case 'checkout':
        return 'Checked out revision 1234.\n'
      case 'export':
        return 'Exported revision 1234.\n'
      case 'import':
        return 'Committed revision 1236.\n'
      case 'add':
        return ''
      case 'delete':
        return ''
      case 'revert':
        return ''
      case 'cleanup':
        return ''
      case 'lock':
        return ''
      case 'unlock':
        return ''
      case 'resolve':
        return ''
      case 'switch':
        return 'Updated to revision 1234.\n'
      case 'copy':
        return 'Committed revision 1237.\n'
      case 'merge':
        return ''
      case 'relocate':
        return ''
      case 'changelist':
        return ''
      case 'move':
      case 'rename':
        return ''
      case 'shelve':
        return ''
      case 'proplist':
        return this.defaultProplistXml()
      case 'propset':
        return ''
      case 'propdel':
        return ''
      case 'propget':
        return ''
      case 'blame':
        return this.defaultBlameXml()
      case 'patch':
        return ''
      default:
        return ''
    }
  }

  // Default XML responses

  private defaultStatusXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
  </target>
</status>`
  }

  private defaultInfoXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<info>
  <entry path="." revision="1234" kind="dir">
    <url>https://example.com/svn/repo/trunk</url>
    <repository>
      <root>https://example.com/svn/repo</root>
      <uuid>12345678-1234-1234-1234-123456789012</uuid>
    </repository>
    <wcroot-abspath>/path/to/working/copy</wcroot-abspath>
    <commit revision="1233">
      <author>testuser</author>
      <date>2024-01-15T10:30:00.000000Z</date>
    </commit>
  </entry>
</info>`
  }

  private defaultLogXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="1234">
    <author>testuser</author>
    <date>2024-01-15T10:30:00.000000Z</date>
    <msg>Test commit message</msg>
  </logentry>
</log>`
  }

  private defaultListXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="https://example.com/svn/repo/trunk">
    <entry kind="dir">
      <name>src</name>
      <commit revision="1234">
        <author>testuser</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
    </entry>
    <entry kind="file">
      <name>README.md</name>
      <size>1024</size>
      <commit revision="1230">
        <author>testuser</author>
        <date>2024-01-14T10:30:00.000000Z</date>
      </commit>
    </entry>
  </list>
</lists>`
  }

  private defaultProplistXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<properties>
</properties>`
  }

  private defaultBlameXml(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<blame>
  <target path="test.txt">
    <entry line-number="1">
      <commit revision="1234">
        <author>testuser</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
      <text>First line of content</text>
    </entry>
  </target>
</blame>`
  }

  private defaultDiffOutput(): string {
    return `Index: file.ts
===================================================================
--- file.ts\t(revision 1234)
+++ file.ts\t(working copy)
@@ -1,3 +1,4 @@
 line1
+new line
 line2
 line3`
  }

  // Test utility methods

  /**
   * Get the call history for assertions
   */
  getCallHistory(): Array<{ args: string[]; cwd?: string; timestamp: number }> {
    return [...this.callHistory]
  }

  /**
   * Get the last call made
   */
  getLastCall(): { args: string[]; cwd?: string; timestamp: number } | undefined {
    return this.callHistory[this.callHistory.length - 1]
  }

  /**
   * Check if a specific command was called
   */
  wasCalled(command: string): boolean {
    return this.callHistory.some(call =>
      call.args.includes(command) || call.args[0] === command
    )
  }

  /**
   * Get the number of times a command was called
   */
  getCallCount(command: string): number {
    return this.callHistory.filter(call =>
      call.args.includes(command) || call.args[0] === command
    ).length
  }

  /**
   * Clear call history
   */
  clearHistory(): void {
    this.callHistory = []
  }

  /**
   * Reset all mock state
   */
  reset(): void {
    this.responses.clear()
    this.customHandler = undefined
    this.callHistory = []
  }
}

/**
 * Factory for creating common mock responses
 */
export const MockSvnResponses = {
  /**
   * Create a status XML response with entries
   */
  status(entries: Array<{ path: string; status: string; revision?: number; author?: string }>): string {
    const entriesXml = entries.map(e => {
      // Include commit info if revision or author is provided
      const hasCommitInfo = e.revision !== undefined || e.author !== undefined
      const commitXml = hasCommitInfo ? `<commit revision="${e.revision || 0}">
          <author>${e.author || 'testuser'}</author>
          <date>2024-01-15T10:30:00.000000Z</date>
        </commit>` : ''

      return `
    <entry path="${e.path}">
      <wc-status item="${e.status}"${e.revision ? ` revision="${e.revision}"` : ''}>
        ${commitXml}
      </wc-status>
    </entry>`
    }).join('')

    return `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">${entriesXml}
  </target>
</status>`
  },

  /**
   * Create an info XML response
   */
  info(options: {
    path?: string
    url?: string
    revision?: number
    repositoryRoot?: string
    uuid?: string
    workingCopyRoot?: string
    author?: string
    lastChangedRevision?: number
  }): string {
    const {
      path = '.',
      url = 'https://example.com/svn/repo/trunk',
      revision = 1234,
      repositoryRoot = 'https://example.com/svn/repo',
      uuid = '12345678-1234-1234-1234-123456789012',
      workingCopyRoot = '/path/to/working/copy',
      author = 'testuser',
      lastChangedRevision = 1233
    } = options

    return `<?xml version="1.0" encoding="UTF-8"?>
<info>
  <entry path="${path}" revision="${revision}" kind="dir">
    <url>${url}</url>
    <repository>
      <root>${repositoryRoot}</root>
      <uuid>${uuid}</uuid>
    </repository>
    <wcroot-abspath>${workingCopyRoot}</wcroot-abspath>
    <commit revision="${lastChangedRevision}">
      <author>${author}</author>
      <date>2024-01-15T10:30:00.000000Z</date>
    </commit>
  </entry>
</info>`
  },

  /**
   * Create a log XML response
   */
  log(entries: Array<{ revision: number; author?: string; date?: string; message?: string }>): string {
    const entriesXml = entries.map(e => `
  <logentry revision="${e.revision}">
    <author>${e.author || 'testuser'}</author>
    <date>${e.date || '2024-01-15T10:30:00.000000Z'}</date>
    <msg>${e.message || `Commit ${e.revision}`}</msg>
  </logentry>`).join('')

    return `<?xml version="1.0" encoding="UTF-8"?>
<log>${entriesXml}
</log>`
  },

  /**
   * Create a list XML response
   */
  list(baseUrl: string, entries: Array<{
    name: string
    kind: 'file' | 'dir'
    size?: number
    revision?: number
    author?: string
  }>): string {
    const entriesXml = entries.map(e => `
    <entry kind="${e.kind}">
      <name>${e.name}</name>
      ${e.size !== undefined ? `<size>${e.size}</size>` : ''}
      <commit revision="${e.revision || 1234}">
        <author>${e.author || 'testuser'}</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
    </entry>`).join('')

    return `<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="${baseUrl}">${entriesXml}
  </list>
</lists>`
  },

  /**
   * Create a diff response
   */
  diff(files: Array<{ oldPath: string; newPath: string; hunks: Array<{ oldStart: number; newStart: number; content: string }> }>): string {
    return files.map(f => {
      const hunksContent = f.hunks.map(h =>
        `@@ -${h.oldStart},1 +${h.newStart},1 @@\n${h.content}`
      ).join('\n')

      return `Index: ${f.newPath}
===================================================================
--- ${f.oldPath}
+++ ${f.newPath}
${hunksContent}`
    }).join('\n')
  },

  /**
   * Create a blame XML response
   */
  blame(lines: Array<{ lineNumber: number; revision: number; author?: string; content: string }>): string {
    const entriesXml = lines.map(l => `
    <entry line-number="${l.lineNumber}">
      <commit revision="${l.revision}">
        <author>${l.author || 'testuser'}</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
      <text>${l.content}</text>
    </entry>`).join('')

    return `<?xml version="1.0" encoding="UTF-8"?>
<blame>
  <target path="test.txt">${entriesXml}
  </target>
</blame>`
  },

  /**
   * Binary file diff indicator
   */
  binaryDiff: 'Cannot display: file marked as a binary type.',

  /**
   * Standard update success message
   */
  updateSuccess(revision: number): string {
    return `Updated to revision ${revision}.\n`
  },

  /**
   * Standard commit success message
   */
  commitSuccess(revision: number): string {
    return `Committed revision ${revision}.\n`
  },

  /**
   * Standard checkout success message
   */
  checkoutSuccess(revision: number): string {
    return `Checked out revision ${revision}.\n`
  }
}

// Export singleton for simple test cases
export const mockSvn = new MockSvnExecutor()
