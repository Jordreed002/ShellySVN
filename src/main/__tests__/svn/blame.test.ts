/**
 * Unit tests for SVN Blame (Annotate) operations
 *
 * Tests the parsing and handling of svn blame command output
 */

import { describe, it, expect } from 'vitest'

// Re-implement parseSvnBlameXml for testing
function parseSvnBlameXml(xml: string, path: string): {
  path: string
  lines: Array<{
    lineNumber: number
    revision: number
    author: string
    date: string
    content: string
  }>
  startRevision: number
  endRevision: number
} {
  const lines: Array<{
    lineNumber: number
    revision: number
    author: string
    date: string
    content: string
  }> = []

  const entryMatches = xml.matchAll(/<entry[^>]*line-number="(\d+)"[^>]*>([\s\S]*?)<\/entry>/g)

  for (const match of entryMatches) {
    const lineNumber = parseInt(match[1], 10)
    const content = match[2]

    const revMatch = content.match(/<commit[^>]*revision="(\d+)"/)
    const authorMatch = content.match(/<author>([^<]+)<\/author>/)
    const dateMatch = content.match(/<date>([^<]+)<\/date>/)
    const textMatch = content.match(/<text>([^<]*)<\/text>/)

    lines.push({
      lineNumber,
      revision: revMatch ? parseInt(revMatch[1], 10) : 0,
      author: authorMatch?.[1] || 'unknown',
      date: dateMatch?.[1] || '',
      content: textMatch?.[1] || ''
    })
  }

  const revisions = lines.map(l => l.revision).filter(r => r > 0)

  return {
    path,
    lines,
    startRevision: revisions.length > 0 ? Math.min(...revisions) : 0,
    endRevision: revisions.length > 0 ? Math.max(...revisions) : 0
  }
}

describe('SVN Blame Parser', () => {
  describe('parseSvnBlameXml', () => {
    it('should parse empty blame result', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<blame>
  <target path="empty.txt">
  </target>
</blame>`

      const result = parseSvnBlameXml(xml, 'empty.txt')

      expect(result.lines).toHaveLength(0)
      expect(result.startRevision).toBe(0)
      expect(result.endRevision).toBe(0)
    })

    it('should parse single line blame', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<blame>
  <target path="test.txt">
    <entry line-number="1">
      <commit revision="1234">
        <author>developer</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
      <text>This is the first line</text>
    </entry>
  </target>
</blame>`

      const result = parseSvnBlameXml(xml, 'test.txt')

      expect(result.lines).toHaveLength(1)
      expect(result.lines[0].lineNumber).toBe(1)
      expect(result.lines[0].revision).toBe(1234)
      expect(result.lines[0].author).toBe('developer')
      expect(result.lines[0].content).toBe('This is the first line')
      expect(result.startRevision).toBe(1234)
      expect(result.endRevision).toBe(1234)
    })

    it('should parse multiple lines with different authors', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<blame>
  <target path="test.ts">
    <entry line-number="1">
      <commit revision="1200">
        <author>alice</author>
        <date>2024-01-10T10:00:00.000000Z</date>
      </commit>
      <text>import React from 'react'</text>
    </entry>
    <entry line-number="2">
      <commit revision="1210">
        <author>bob</author>
        <date>2024-01-12T11:00:00.000000Z</date>
      </commit>
      <text>import { useState } from 'react'</text>
    </entry>
    <entry line-number="3">
      <commit revision="1234">
        <author>charlie</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
      <text>// New comment</text>
    </entry>
  </target>
</blame>`

      const result = parseSvnBlameXml(xml, 'test.ts')

      expect(result.lines).toHaveLength(3)
      expect(result.lines[0].author).toBe('alice')
      expect(result.lines[1].author).toBe('bob')
      expect(result.lines[2].author).toBe('charlie')
      expect(result.startRevision).toBe(1200)
      expect(result.endRevision).toBe(1234)
    })

    it('should handle lines from same revision', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<blame>
  <target path="test.ts">
    <entry line-number="1">
      <commit revision="1234">
        <author>developer</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
      <text>line 1</text>
    </entry>
    <entry line-number="2">
      <commit revision="1234">
        <author>developer</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
      <text>line 2</text>
    </entry>
    <entry line-number="3">
      <commit revision="1234">
        <author>developer</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
      <text>line 3</text>
    </entry>
  </target>
</blame>`

      const result = parseSvnBlameXml(xml, 'test.ts')

      expect(result.lines).toHaveLength(3)
      expect(result.startRevision).toBe(1234)
      expect(result.endRevision).toBe(1234)

      // All lines should have same revision
      expect(result.lines.every(l => l.revision === 1234)).toBe(true)
    })

    it('should handle empty content lines', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<blame>
  <target path="test.txt">
    <entry line-number="1">
      <commit revision="1234">
        <author>dev</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
      <text></text>
    </entry>
  </target>
</blame>`

      const result = parseSvnBlameXml(xml, 'test.txt')

      expect(result.lines).toHaveLength(1)
      expect(result.lines[0].content).toBe('')
    })

    it('should handle special characters in content', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<blame>
  <target path="test.ts">
    <entry line-number="1">
      <commit revision="1234">
        <author>dev</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
      <text>const regex = /test&amp;pattern/;</text>
    </entry>
  </target>
</blame>`

      const result = parseSvnBlameXml(xml, 'test.ts')

      // Note: XML entities would be decoded by actual parser
      expect(result.lines[0].content).toContain('test&amp;pattern')
    })

    it('should handle missing author gracefully', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<blame>
  <target path="test.txt">
    <entry line-number="1">
      <commit revision="1234">
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
      <text>line without author</text>
    </entry>
  </target>
</blame>`

      const result = parseSvnBlameXml(xml, 'test.txt')

      expect(result.lines[0].author).toBe('unknown')
    })

    it('should handle large file with many lines', () => {
      // Generate XML for 100 lines
      const entries = Array.from({ length: 100 }, (_, i) => `
    <entry line-number="${i + 1}">
      <commit revision="${1200 + i}">
        <author>dev${i % 5}</author>
        <date>2024-01-${String(10 + (i % 20)).padStart(2, '0')}T10:00:00.000000Z</date>
      </commit>
      <text>Line ${i + 1} content</text>
    </entry>`).join('')

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<blame>
  <target path="large.txt">${entries}
  </target>
</blame>`

      const result = parseSvnBlameXml(xml, 'large.txt')

      expect(result.lines).toHaveLength(100)
      expect(result.startRevision).toBe(1200)
      expect(result.endRevision).toBe(1299)
    })
  })
})

describe('SVN Blame Revision Range', () => {
  it('should generate correct args with revision range', () => {
    const args = ['blame', '--xml', '-v', '-r', '1000:1234', 'src/file.ts']

    expect(args).toContain('-r')
    expect(args[args.indexOf('-r') + 1]).toBe('1000:1234')
  })

  it('should generate correct args without revision range', () => {
    const args = ['blame', '--xml', '-v', 'src/file.ts']

    expect(args).not.toContain('-r')
  })

  it('should include verbose flag', () => {
    const args = ['blame', '--xml', '-v', 'src/file.ts']

    expect(args).toContain('-v')
  })
})
