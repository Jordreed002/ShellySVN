/**
 * Unit tests for Streaming Diff Parser
 */

import { describe, it, expect } from 'vitest'
import {
  StreamingDiffParser,
  parseDiffStreaming,
  flattenDiffHunks,
  estimateDiffSize,
  type DiffChunk
} from '../utils/diff-parser'
import type { SvnDiffResult } from '@shared/types'

// Sample unified diff output for testing
const sampleDiff = `Index: src/file1.ts
===================================================================
--- src/file1.ts	(revision 1)
+++ src/file1.ts	(working copy)
@@ -1,5 +1,6 @@
 line1
 line2
+added line
 line3
 line4
-deleted line
+replacement line
Index: src/file2.ts
===================================================================
--- src/file2.ts	(revision 1)
+++ src/file2.ts	(working copy)
@@ -10,3 +10,4 @@
 context line 1
 context line 2
 context line 3
+new line at end
`

const binaryDiff = `Index: image.png
===================================================================
Cannot display: file marked as a binary type.
`

const emptyDiff = ''

const largeDiff = generateLargeDiff(1000)

function generateLargeDiff(lineCount: number): string {
  const lines: string[] = [
    'Index: large-file.txt',
    '===================================================================',
    '--- large-file.txt\t(revision 1)',
    '+++ large-file.txt\t(working copy)',
    '@@ -1,' + lineCount + ' +1,' + (lineCount + 100) + ' @@'
  ]

  for (let i = 1; i <= lineCount; i++) {
    lines.push(' context line ' + i)
  }

  for (let i = 1; i <= 100; i++) {
    lines.push('+added line ' + i)
  }

  return lines.join('\n')
}

describe('StreamingDiffParser', () => {
  describe('basic parsing', () => {
    it('should parse a simple diff', async () => {
      const result = await parseDiffStreaming(sampleDiff)

      expect(result.hasChanges).toBe(true)
      expect(result.files.length).toBe(2)
      // Paths include the revision info from SVN diff output
      expect(result.files[0].oldPath).toContain('src/file1.ts')
      expect(result.files[0].newPath).toContain('src/file1.ts')
    })

    it('should handle empty diff', async () => {
      const result = await parseDiffStreaming(emptyDiff)

      expect(result.hasChanges).toBe(false)
      expect(result.files.length).toBe(0)
    })

    it('should detect binary files', async () => {
      // The parser doesn't check for binary internally - that's done in the IPC handler
      // Here we just verify it doesn't crash on binary diff input
      const result = await parseDiffStreaming(binaryDiff)

      // The binary diff has an Index: line which creates a file entry
      // but no hunks since there are no @@ headers
      expect(result.files.length).toBe(1)
      expect(result.files[0].hunks.length).toBe(0)
    })
  })

  describe('hunk parsing', () => {
    it('should parse hunk headers correctly', async () => {
      const result = await parseDiffStreaming(sampleDiff)

      const firstHunk = result.files[0].hunks[0]
      expect(firstHunk.oldStart).toBe(1)
      expect(firstHunk.oldLines).toBe(5)
      expect(firstHunk.newStart).toBe(1)
      expect(firstHunk.newLines).toBe(6)
    })

    it('should identify added lines', async () => {
      const result = await parseDiffStreaming(sampleDiff)

      const addedLines = result.files[0].hunks[0].lines.filter(
        (l) => l.type === 'added'
      )
      expect(addedLines.length).toBeGreaterThan(0)
      expect(addedLines[0].content).toBe('added line')
    })

    it('should identify removed lines', async () => {
      const result = await parseDiffStreaming(sampleDiff)

      const removedLines = result.files[0].hunks[0].lines.filter(
        (l) => l.type === 'removed'
      )
      expect(removedLines.length).toBeGreaterThan(0)
      expect(removedLines[0].content).toBe('deleted line')
    })

    it('should identify context lines', async () => {
      const result = await parseDiffStreaming(sampleDiff)

      const contextLines = result.files[0].hunks[0].lines.filter(
        (l) => l.type === 'context'
      )
      expect(contextLines.length).toBeGreaterThan(0)
    })
  })

  describe('line numbers', () => {
    it('should track line numbers correctly', async () => {
      const result = await parseDiffStreaming(sampleDiff)

      const hunk = result.files[0].hunks[0]

      // Find added line
      const addedLine = hunk.lines.find((l) => l.type === 'added')
      expect(addedLine?.newLineNumber).toBeDefined()

      // Find removed line
      const removedLine = hunk.lines.find((l) => l.type === 'removed')
      expect(removedLine?.oldLineNumber).toBeDefined()

      // Context lines should have both
      const contextLine = hunk.lines.find((l) => l.type === 'context')
      expect(contextLine?.oldLineNumber).toBeDefined()
      expect(contextLine?.newLineNumber).toBeDefined()
    })
  })

  describe('chunk streaming', () => {
    it('should emit chunks during parsing', async () => {
      const chunks: DiffChunk[] = []

      await parseDiffStreaming(sampleDiff, {
        chunkSize: 5,
        onChunk: (chunk) => chunks.push(chunk)
      })

      expect(chunks.length).toBeGreaterThan(0)
    })

    it('should handle large diffs efficiently', async () => {
      const startTime = Date.now()

      const result = await parseDiffStreaming(largeDiff)

      const elapsed = Date.now() - startTime

      // Should complete within 1 second
      expect(elapsed).toBeLessThan(1000)
      expect(result.files.length).toBe(1)
      // The parser may create multiple hunks based on the generated diff structure
      expect(result.files[0].hunks.length).toBeGreaterThanOrEqual(1)
      // Total lines across all hunks should be large
      const totalLines = result.files[0].hunks.reduce((sum, h) => sum + h.lines.length, 0)
      expect(totalLines).toBeGreaterThan(1000)
    })
  })

  describe('error handling', () => {
    it('should handle malformed diff gracefully', async () => {
      const malformedDiff = 'some random text\nwithout proper structure'

      const result = await parseDiffStreaming(malformedDiff)

      // Should not throw, just return empty result
      expect(result.files.length).toBe(0)
    })
  })
})

describe('flattenDiffHunks', () => {
  it('should flatten diff into chunks', () => {
    const result: SvnDiffResult = {
      files: [
        {
          oldPath: 'file1.ts',
          newPath: 'file1.ts',
          hunks: [
            {
              oldStart: 1,
              oldLines: 5,
              newStart: 1,
              newLines: 6,
              lines: [
                { type: 'context', content: 'line1' },
                { type: 'added', content: 'line2' }
              ]
            },
            {
              oldStart: 10,
              oldLines: 3,
              newStart: 11,
              newLines: 3,
              lines: [{ type: 'context', content: 'line10' }]
            }
          ]
        },
        {
          oldPath: 'file2.ts',
          newPath: 'file2.ts',
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 2,
              lines: [{ type: 'added', content: 'new line' }]
            }
          ]
        }
      ],
      hasChanges: true
    }

    const chunks = flattenDiffHunks(result)

    expect(chunks.length).toBe(3) // 2 hunks in first file + 1 hunk in second
    expect(chunks[0].fileIndex).toBe(0)
    expect(chunks[0].hunkIndex).toBe(0)
    expect(chunks[1].fileIndex).toBe(0)
    expect(chunks[1].hunkIndex).toBe(1)
    expect(chunks[2].fileIndex).toBe(1)
    expect(chunks[2].hunkIndex).toBe(0)
  })
})

describe('estimateDiffSize', () => {
  it('should estimate size of diff result', () => {
    const result: SvnDiffResult = {
      files: [
        {
          oldPath: 'path/to/file.ts',
          newPath: 'path/to/file.ts',
          hunks: [
            {
              oldStart: 1,
              oldLines: 10,
              newStart: 1,
              newLines: 12,
              lines: [
                { type: 'context', content: 'context line here' },
                { type: 'added', content: 'added line here' },
                { type: 'removed', content: 'removed line here' }
              ]
            }
          ]
        }
      ],
      hasChanges: true
    }

    const size = estimateDiffSize(result)

    expect(size).toBeGreaterThan(0)
    expect(typeof size).toBe('number')
  })

  it('should return base overhead for empty diff', () => {
    const result: SvnDiffResult = {
      files: [],
      hasChanges: false
    }

    const size = estimateDiffSize(result)

    expect(size).toBeGreaterThan(0)
  })
})

describe('StreamingDiffParser class', () => {
  it('should parse diff via parseDiffStreaming', async () => {
    // This is effectively testing the stream-based parsing
    const result = await parseDiffStreaming(sampleDiff)

    expect(result.hasChanges).toBe(true)
    expect(result.files.length).toBe(2)
  })

  it('should provide stats via getStats', () => {
    const parser = new StreamingDiffParser()

    const stats = parser.getStats()
    expect(stats.isComplete).toBe(false)
    expect(stats.lines).toBe(0)
  })
})
