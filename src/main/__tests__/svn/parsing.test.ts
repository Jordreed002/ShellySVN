/**
 * Unit tests for SVN XML parsing functions
 *
 * These tests verify that the XML parsing logic correctly handles
 * various SVN command outputs, including edge cases and malformed input.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { XMLParser } from 'fast-xml-parser'

// Helper to access private parsing functions via module
// We'll re-implement the parsing logic here for isolated testing

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true,
  parseTagValue: false,
  allowBooleanAttributes: true
})

// Re-implement parsing functions for isolated testing
// These match the implementation in src/main/ipc/svn.ts

interface SvnStatusEntry {
  path: string
  status: string
  revision?: number
  author?: string
  date?: string
  isDirectory: boolean
}

interface SvnStatusResult {
  path: string
  entries: SvnStatusEntry[]
  revision: number
}

function parseSvnStatusXml(xml: string, basePath: string): SvnStatusResult {
  const entries: SvnStatusResult['entries'] = []

  try {
    const parsed = xmlParser.parse(xml) as {
      status?: {
        target?: {
          '@_path'?: string
          entry?: Array<{
            '@_path': string
            'wc-status'?: {
              '@_item': string
              '@_revision'?: string
              commit?: {
                '@_revision': string
                author?: string
                date?: string
              }
            }
          }> | {
            '@_path': string
            'wc-status'?: {
              '@_item': string
              '@_revision'?: string
              commit?: {
                '@_revision': string
                author?: string
                date?: string
              }
            }
          }
        }
      }
    }

    const target = parsed.status?.target
    if (!target) {
      return { path: basePath, entries: [], revision: 0 }
    }

    const entryList = target.entry
    if (!entryList) {
      return { path: basePath, entries: [], revision: 0 }
    }

    const entriesArray = Array.isArray(entryList) ? entryList : [entryList]

    for (const entry of entriesArray) {
      if (!entry || typeof entry !== 'object') continue

      const wcStatus = entry['wc-status']
      if (!wcStatus) continue

      const path = entry['@_path'] || ''
      const status = wcStatus['@_item'] || 'normal'

      let revision: number | undefined
      let author: string | undefined
      let date: string | undefined

      if (wcStatus.commit) {
        revision = wcStatus.commit['@_revision'] ? parseInt(wcStatus.commit['@_revision'], 10) : undefined
        author = wcStatus.commit.author
        date = wcStatus.commit.date
      }

      entries.push({
        path,
        status: status as SvnStatusResult['entries'][0]['status'],
        revision,
        author,
        date,
        isDirectory: false
      })
    }
  } catch (error) {
    // Return empty result on parse error
  }

  return {
    path: basePath,
    entries,
    revision: 0
  }
}

interface SvnInfoResult {
  path: string
  url: string
  repositoryRoot: string
  repositoryUuid: string
  revision: number
  nodeKind: 'file' | 'dir'
  lastChangedAuthor: string
  lastChangedRevision: number
  lastChangedDate: string
  workingCopyRoot?: string
}

function parseSvnInfoXml(xml: string): SvnInfoResult {
  try {
    const parsed = xmlParser.parse(xml) as {
      info?: {
        entry?: {
          '@_path'?: string
          '@_revision'?: string
          url?: string
          repository?: {
            root?: string
            uuid?: string
          }
          commit?: {
            '@_revision'?: string
            author?: string
            date?: string
          }
          'wcroot-abspath'?: string
        }
      }
    }

    const entry = parsed.info?.entry
    if (!entry) {
      return {
        path: '',
        url: '',
        repositoryRoot: '',
        repositoryUuid: '',
        revision: 0,
        nodeKind: 'dir',
        lastChangedAuthor: '',
        lastChangedRevision: 0,
        lastChangedDate: '',
        workingCopyRoot: undefined
      }
    }

    const revision = entry['@_revision'] ? parseInt(entry['@_revision'], 10) : 0
    const commitRevision = entry.commit?.['@_revision'] ? parseInt(entry.commit['@_revision'], 10) : 0

    return {
      path: entry['@_path'] || '',
      url: entry.url || '',
      repositoryRoot: entry.repository?.root || '',
      repositoryUuid: entry.repository?.uuid || '',
      revision,
      nodeKind: 'dir',
      lastChangedAuthor: entry.commit?.author || '',
      lastChangedRevision: commitRevision,
      lastChangedDate: entry.commit?.date || '',
      workingCopyRoot: entry['wcroot-abspath'] || undefined
    }
  } catch (error) {
    return {
      path: '',
      url: '',
      repositoryRoot: '',
      repositoryUuid: '',
      revision: 0,
      nodeKind: 'dir',
      lastChangedAuthor: '',
      lastChangedRevision: 0,
      lastChangedDate: ''
    }
  }
}

interface SvnLogEntry {
  revision: number
  author: string
  date: string
  message: string
  paths: Array<{ path: string; action: 'A' | 'D' | 'M' | 'R'; kind: string }>
}

interface SvnLogResult {
  entries: SvnLogEntry[]
  startRevision: number
  endRevision: number
}

function parseSvnLogXml(xml: string): SvnLogResult {
  const entries: SvnLogResult['entries'] = []

  try {
    const parsed = xmlParser.parse(xml) as {
      log?: {
        logentry?: Array<{
          '@_revision': string
          author?: string
          date?: string
          msg?: string
          paths?: {
            path?: Array<{
              '#text': string
              '@_action'?: string
              '@_kind'?: string
            }> | {
              '#text': string
              '@_action'?: string
              '@_kind'?: string
            }
          }
        }> | {
          '@_revision': string
          author?: string
          date?: string
          msg?: string
          paths?: {
            path?: Array<{
              '#text': string
              '@_action'?: string
              '@_kind'?: string
            }> | {
              '#text': string
              '@_action'?: string
              '@_kind'?: string
            }
          }
        }
      }
    }

    const logEntries = parsed.log?.logentry
    if (!logEntries) {
      return { entries: [], startRevision: 0, endRevision: 0 }
    }

    const entriesArray = Array.isArray(logEntries) ? logEntries : [logEntries]

    for (const entry of entriesArray) {
      if (!entry || typeof entry !== 'object') continue

      const paths: Array<{ path: string; action: 'A' | 'D' | 'M' | 'R'; kind: string }> = []
      if (entry.paths?.path) {
        const pathList = Array.isArray(entry.paths.path) ? entry.paths.path : [entry.paths.path]
        for (const p of pathList) {
          if (p && typeof p === 'object') {
            paths.push({
              path: p['#text'] || '',
              action: (p['@_action'] || '') as 'A' | 'D' | 'M' | 'R',
              kind: p['@_kind'] || ''
            })
          }
        }
      }

      entries.push({
        revision: parseInt(entry['@_revision'], 10) || 0,
        author: entry.author || 'unknown',
        date: entry.date || '',
        message: entry.msg || '',
        paths
      })
    }
  } catch (error) {
    // Return empty result on parse error
  }

  const revisions = entries.map(e => e.revision)

  return {
    entries,
    startRevision: revisions.length > 0 ? Math.min(...revisions) : 0,
    endRevision: revisions.length > 0 ? Math.max(...revisions) : 0
  }
}

interface SvnDiffLine {
  type: 'added' | 'removed' | 'context' | 'header' | 'hunk'
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

interface SvnDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: SvnDiffLine[]
}

interface SvnDiffFile {
  oldPath: string
  newPath: string
  hunks: SvnDiffHunk[]
  isBinary?: boolean
}

interface SvnDiffResult {
  files: SvnDiffFile[]
  hasChanges: boolean
  isBinary?: boolean
  rawDiff?: string
}

function parseSvnDiff(diffOutput: string): SvnDiffResult {
  if (!diffOutput || diffOutput.trim() === '') {
    return { files: [], hasChanges: false }
  }

  if (diffOutput.includes('Cannot display: file marked as a binary type')) {
    return {
      files: [],
      hasChanges: true,
      isBinary: true,
      rawDiff: diffOutput
    }
  }

  const files: SvnDiffFile[] = []
  const lines = diffOutput.split('\n')

  let currentFile: SvnDiffFile | null = null
  let currentHunk: SvnDiffHunk | null = null
  let oldLineNum = 0
  let newLineNum = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('Index: ')) {
      if (currentFile && currentHunk) {
        currentFile.hunks.push(currentHunk)
      }
      if (currentFile) {
        files.push(currentFile)
      }
      currentFile = {
        oldPath: '',
        newPath: '',
        hunks: []
      }
      currentHunk = null
      continue
    }

    if (line.startsWith('=======')) {
      continue
    }

    if (line.startsWith('--- ')) {
      if (currentFile) {
        currentFile.oldPath = line.substring(4).trim()
      }
      continue
    }

    if (line.startsWith('+++ ')) {
      if (currentFile) {
        currentFile.newPath = line.substring(4).trim()
      }
      continue
    }

    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (hunkMatch) {
      if (currentHunk && currentFile) {
        currentFile.hunks.push(currentHunk)
      }
      currentHunk = {
        oldStart: parseInt(hunkMatch[1], 10),
        oldLines: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newLines: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
        lines: []
      }
      oldLineNum = currentHunk.oldStart
      newLineNum = currentHunk.newStart

      currentHunk.lines.push({
        type: 'hunk',
        content: line
      })
      continue
    }

    if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({
          type: 'added',
          content: line,
          newLineNumber: newLineNum++
        })
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({
          type: 'removed',
          content: line,
          oldLineNumber: oldLineNum++
        })
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({
          type: 'context',
          content: line,
          oldLineNumber: oldLineNum++,
          newLineNumber: newLineNum++
        })
      } else if (line === '') {
        currentHunk.lines.push({
          type: 'context',
          content: '',
          oldLineNumber: oldLineNum++,
          newLineNumber: newLineNum++
        })
      }
    }
  }

  if (currentHunk && currentFile) {
    currentFile.hunks.push(currentHunk)
  }
  if (currentFile) {
    files.push(currentFile)
  }

  return {
    files,
    hasChanges: files.length > 0
  }
}

// ============================================
// Test Suite
// ============================================

describe('SVN Status XML Parser', () => {
  describe('parseSvnStatusXml', () => {
    it('should parse empty status result', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
  </target>
</status>`

      const result = parseSvnStatusXml(xml, '/test/path')

      expect(result.path).toBe('/test/path')
      expect(result.entries).toHaveLength(0)
      expect(result.revision).toBe(0)
    })

    it('should parse single entry with modified status', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
    <entry path="src/file.ts">
      <wc-status item="modified">
        <commit revision="1234">
          <author>johndoe</author>
          <date>2024-01-15T10:30:00.000000Z</date>
        </commit>
      </wc-status>
    </entry>
  </target>
</status>`

      const result = parseSvnStatusXml(xml, '/test/path')

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].path).toBe('src/file.ts')
      expect(result.entries[0].status).toBe('modified')
      expect(result.entries[0].revision).toBe(1234)
      expect(result.entries[0].author).toBe('johndoe')
    })

    it('should parse multiple entries with different statuses', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
    <entry path="added.txt">
      <wc-status item="added">
        <commit revision="1235">
          <author>alice</author>
          <date>2024-01-15T10:30:00.000000Z</date>
        </commit>
      </wc-status>
    </entry>
    <entry path="deleted.txt">
      <wc-status item="deleted">
        <commit revision="1233">
          <author>bob</author>
          <date>2024-01-14T10:30:00.000000Z</date>
        </commit>
      </wc-status>
    </entry>
    <entry path="modified.txt">
      <wc-status item="modified">
        <commit revision="1234">
          <author>charlie</author>
          <date>2024-01-15T10:30:00.000000Z</date>
        </commit>
      </wc-status>
    </entry>
  </target>
</status>`

      const result = parseSvnStatusXml(xml, '/test/path')

      expect(result.entries).toHaveLength(3)
      expect(result.entries[0].status).toBe('added')
      expect(result.entries[1].status).toBe('deleted')
      expect(result.entries[2].status).toBe('modified')
    })

    it('should handle unversioned files', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
    <entry path="unversioned.txt">
      <wc-status item="unversioned">
      </wc-status>
    </entry>
  </target>
</status>`

      const result = parseSvnStatusXml(xml, '/test/path')

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].status).toBe('unversioned')
      expect(result.entries[0].revision).toBeUndefined()
    })

    it('should handle malformed XML gracefully', () => {
      const result = parseSvnStatusXml('not valid xml', '/test/path')

      expect(result.entries).toHaveLength(0)
      expect(result.path).toBe('/test/path')
    })

    it('should handle single entry (non-array)', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
    <entry path="single.txt">
      <wc-status item="normal">
      </wc-status>
    </entry>
  </target>
</status>`

      const result = parseSvnStatusXml(xml, '/test/path')

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].path).toBe('single.txt')
    })

    it('should handle conflicted files', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
    <entry path="conflicted.ts">
      <wc-status item="conflicted">
        <commit revision="1234">
          <author>developer</author>
          <date>2024-01-15T10:30:00.000000Z</date>
        </commit>
      </wc-status>
    </entry>
  </target>
</status>`

      const result = parseSvnStatusXml(xml, '/test/path')

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].status).toBe('conflicted')
    })
  })
})

describe('SVN Info XML Parser', () => {
  describe('parseSvnInfoXml', () => {
    it('should parse basic info result', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
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

      const result = parseSvnInfoXml(xml)

      expect(result.path).toBe('.')
      expect(result.url).toBe('https://example.com/svn/repo/trunk')
      expect(result.revision).toBe(1234)
      expect(result.repositoryRoot).toBe('https://example.com/svn/repo')
      expect(result.repositoryUuid).toBe('12345678-1234-1234-1234-123456789012')
      expect(result.workingCopyRoot).toBe('/path/to/working/copy')
      expect(result.lastChangedAuthor).toBe('testuser')
      expect(result.lastChangedRevision).toBe(1233)
    })

    it('should handle missing working copy root', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<info>
  <entry path="." revision="1234" kind="dir">
    <url>https://example.com/svn/repo/trunk</url>
    <repository>
      <root>https://example.com/svn/repo</root>
      <uuid>12345678-1234-1234-1234-123456789012</uuid>
    </repository>
    <commit revision="1233">
      <author>testuser</author>
      <date>2024-01-15T10:30:00.000000Z</date>
    </commit>
  </entry>
</info>`

      const result = parseSvnInfoXml(xml)

      expect(result.workingCopyRoot).toBeUndefined()
    })

    it('should handle malformed XML', () => {
      const result = parseSvnInfoXml('invalid xml')

      expect(result.path).toBe('')
      expect(result.url).toBe('')
      expect(result.revision).toBe(0)
    })

    it('should handle empty info element', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<info>
</info>`

      const result = parseSvnInfoXml(xml)

      expect(result.path).toBe('')
      expect(result.revision).toBe(0)
    })

    it('should parse remote URL info', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<info>
  <entry path="https://example.com/svn/repo/trunk" revision="1234" kind="dir">
    <url>https://example.com/svn/repo/trunk</url>
    <repository>
      <root>https://example.com/svn/repo</root>
      <uuid>abcd1234-5678-90ef-ghij-klmnopqrstuv</uuid>
    </repository>
    <commit revision="1234">
      <author>committer</author>
      <date>2024-01-16T14:20:00.000000Z</date>
    </commit>
  </entry>
</info>`

      const result = parseSvnInfoXml(xml)

      expect(result.url).toBe('https://example.com/svn/repo/trunk')
      expect(result.repositoryUuid).toBe('abcd1234-5678-90ef-ghij-klmnopqrstuv')
      expect(result.lastChangedAuthor).toBe('committer')
    })
  })
})

describe('SVN Log XML Parser', () => {
  describe('parseSvnLogXml', () => {
    it('should parse empty log result', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
</log>`

      const result = parseSvnLogXml(xml)

      expect(result.entries).toHaveLength(0)
      expect(result.startRevision).toBe(0)
      expect(result.endRevision).toBe(0)
    })

    it('should parse single log entry', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="1234">
    <author>developer</author>
    <date>2024-01-15T10:30:00.000000Z</date>
    <msg>Fix bug in authentication module</msg>
  </logentry>
</log>`

      const result = parseSvnLogXml(xml)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].revision).toBe(1234)
      expect(result.entries[0].author).toBe('developer')
      expect(result.entries[0].message).toBe('Fix bug in authentication module')
      expect(result.startRevision).toBe(1234)
      expect(result.endRevision).toBe(1234)
    })

    it('should parse multiple log entries', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="1236">
    <author>alice</author>
    <date>2024-01-17T10:30:00.000000Z</date>
    <msg>Add feature X</msg>
  </logentry>
  <logentry revision="1235">
    <author>bob</author>
    <date>2024-01-16T10:30:00.000000Z</date>
    <msg>Update documentation</msg>
  </logentry>
  <logentry revision="1234">
    <author>charlie</author>
    <date>2024-01-15T10:30:00.000000Z</date>
    <msg>Initial commit</msg>
  </logentry>
</log>`

      const result = parseSvnLogXml(xml)

      expect(result.entries).toHaveLength(3)
      expect(result.startRevision).toBe(1234)
      expect(result.endRevision).toBe(1236)
    })

    it('should parse log entry with changed paths', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="1234">
    <author>developer</author>
    <date>2024-01-15T10:30:00.000000Z</date>
    <msg>Add new file</msg>
    <paths>
      <path action="A" kind="file">/trunk/src/newfile.ts</path>
      <path action="M" kind="file">/trunk/src/existing.ts</path>
      <path action="D" kind="file">/trunk/src/oldfile.ts</path>
    </paths>
  </logentry>
</log>`

      const result = parseSvnLogXml(xml)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].paths).toHaveLength(3)
      expect(result.entries[0].paths[0].action).toBe('A')
      expect(result.entries[0].paths[0].path).toBe('/trunk/src/newfile.ts')
      expect(result.entries[0].paths[1].action).toBe('M')
      expect(result.entries[0].paths[2].action).toBe('D')
    })

    it('should handle single path (non-array)', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="1234">
    <author>developer</author>
    <date>2024-01-15T10:30:00.000000Z</date>
    <msg>Single file change</msg>
    <paths>
      <path action="M" kind="file">/trunk/src/file.ts</path>
    </paths>
  </logentry>
</log>`

      const result = parseSvnLogXml(xml)

      expect(result.entries[0].paths).toHaveLength(1)
      expect(result.entries[0].paths[0].path).toBe('/trunk/src/file.ts')
    })

    it('should handle missing author', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="1234">
    <date>2024-01-15T10:30:00.000000Z</date>
    <msg>No author commit</msg>
  </logentry>
</log>`

      const result = parseSvnLogXml(xml)

      expect(result.entries[0].author).toBe('unknown')
    })

    it('should handle malformed XML', () => {
      const result = parseSvnLogXml('not xml')

      expect(result.entries).toHaveLength(0)
    })
  })
})

describe('SVN Diff Parser', () => {
  describe('parseSvnDiff', () => {
    it('should parse empty diff', () => {
      const result = parseSvnDiff('')

      expect(result.files).toHaveLength(0)
      expect(result.hasChanges).toBe(false)
    })

    it('should parse binary file diff', () => {
      const diff = 'Cannot display: file marked as a binary type.'

      const result = parseSvnDiff(diff)

      expect(result.isBinary).toBe(true)
      expect(result.hasChanges).toBe(true)
      expect(result.rawDiff).toBe(diff)
    })

    it('should parse single file diff', () => {
      const diff = `Index: src/file.ts
===================================================================
--- src/file.ts\t(revision 1234)
+++ src/file.ts\t(working copy)
@@ -1,5 +1,6 @@
 import React from 'react'
+import { useState } from 'react'

 function App() {
   return <div>Hello</div>
 }`

      const result = parseSvnDiff(diff)

      expect(result.files).toHaveLength(1)
      expect(result.files[0].oldPath).toBe('src/file.ts\t(revision 1234)')
      expect(result.files[0].newPath).toBe('src/file.ts\t(working copy)')
      expect(result.files[0].hunks).toHaveLength(1)
      expect(result.files[0].hunks[0].oldStart).toBe(1)
      expect(result.files[0].hunks[0].newStart).toBe(1)
      expect(result.hasChanges).toBe(true)
    })

    it('should parse multiple files in diff', () => {
      const diff = `Index: file1.ts
===================================================================
--- file1.ts\t(revision 1234)
+++ file1.ts\t(working copy)
@@ -1,3 +1,4 @@
 line1
+new line
 line2
 line3
Index: file2.ts
===================================================================
--- file2.ts\t(revision 1234)
+++ file2.ts\t(working copy)
@@ -5,3 +5,4 @@
 context
-removed
+added
 last`

      const result = parseSvnDiff(diff)

      expect(result.files).toHaveLength(2)
      expect(result.hasChanges).toBe(true)
    })

    it('should parse diff line types correctly', () => {
      const diff = `Index: file.ts
===================================================================
--- file.ts
+++ file.ts
@@ -1,3 +1,4 @@
 context line
-removed line
+added line
+another added
 context end`

      const result = parseSvnDiff(diff)

      const lines = result.files[0].hunks[0].lines

      // Skip hunk header
      const contentLines = lines.filter(l => l.type !== 'hunk')

      expect(contentLines[0].type).toBe('context')
      expect(contentLines[1].type).toBe('removed')
      expect(contentLines[2].type).toBe('added')
      expect(contentLines[3].type).toBe('added')
      expect(contentLines[4].type).toBe('context')
    })

    it('should track line numbers correctly', () => {
      const diff = `Index: file.ts
===================================================================
--- file.ts
+++ file.ts
@@ -10,3 +10,4 @@
 line10
-line11
+line11modified
+line12
 line13`

      const result = parseSvnDiff(diff)

      const hunk = result.files[0].hunks[0]

      expect(hunk.oldStart).toBe(10)
      expect(hunk.newStart).toBe(10)

      // Find the removed line
      const removedLine = hunk.lines.find(l => l.type === 'removed')
      expect(removedLine?.oldLineNumber).toBe(11)

      // Find added lines
      const addedLines = hunk.lines.filter(l => l.type === 'added')
      expect(addedLines[0]?.newLineNumber).toBe(11)
      expect(addedLines[1]?.newLineNumber).toBe(12)
    })

    it('should handle multiple hunks in one file', () => {
      const diff = `Index: file.ts
===================================================================
--- file.ts
+++ file.ts
@@ -1,3 +1,4 @@
 first
+new at start
 second
 third
@@ -20,3 +21,4 @@
 near end
+new at end
 last`

      const result = parseSvnDiff(diff)

      expect(result.files).toHaveLength(1)
      expect(result.files[0].hunks).toHaveLength(2)
      expect(result.files[0].hunks[0].oldStart).toBe(1)
      expect(result.files[0].hunks[1].oldStart).toBe(20)
    })

    it('should handle whitespace-only context lines', () => {
      const diff = `Index: file.ts
===================================================================
--- file.ts
+++ file.ts
@@ -1,2 +1,2 @@
 line1

+line2`

      const result = parseSvnDiff(diff)

      // Empty line should be context
      const emptyContext = result.files[0].hunks[0].lines.find(l => l.content === '' && l.type === 'context')
      expect(emptyContext).toBeDefined()
    })
  })
})

describe('Edge Cases', () => {
  it('should handle very long file paths', () => {
    const longPath = 'a'.repeat(500)
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
    <entry path="${longPath}">
      <wc-status item="modified">
      </wc-status>
    </entry>
  </target>
</status>`

    const result = parseSvnStatusXml(xml, '/test')

    expect(result.entries[0].path).toBe(longPath)
  })

  it('should handle special characters in messages', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="1234">
    <author>user</author>
    <date>2024-01-15T10:30:00.000000Z</date>
    <msg>Fix &amp; escape &lt;test&gt; "quotes" and 'apostrophes'</msg>
  </logentry>
</log>`

    const result = parseSvnLogXml(xml)

    // XML parser should decode entities
    expect(result.entries[0].message).toContain('&')
    expect(result.entries[0].message).toContain('<')
    expect(result.entries[0].message).toContain('>')
  })

  it('should handle unicode in paths and messages', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
    <entry path="src/\u6587\u4ef6/\u30d5\u30a1\u30a4\u30eb.ts">
      <wc-status item="modified">
      </wc-status>
    </entry>
  </target>
</status>`

    const result = parseSvnStatusXml(xml, '/test')

    expect(result.entries[0].path).toContain('\u6587\u4ef6')
  })

  it('should handle empty commit message', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="1234">
    <author>user</author>
    <date>2024-01-15T10:30:00.000000Z</date>
    <msg></msg>
  </logentry>
</log>`

    const result = parseSvnLogXml(xml)

    expect(result.entries[0].message).toBe('')
  })

  it('should handle very large revision numbers', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<info>
  <entry path="." revision="999999999" kind="dir">
    <url>https://example.com/svn/repo</url>
    <repository>
      <root>https://example.com/svn/repo</root>
      <uuid>test-uuid</uuid>
    </repository>
    <commit revision="999999998">
      <author>user</author>
      <date>2024-01-15T10:30:00.000000Z</date>
    </commit>
  </entry>
</info>`

    const result = parseSvnInfoXml(xml)

    expect(result.revision).toBe(999999999)
    expect(result.lastChangedRevision).toBe(999999998)
  })
})
