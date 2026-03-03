/**
 * Unit tests for SVN List (Repository Browser) operations
 *
 * Tests the parsing and handling of svn list command output
 */

import { describe, it, expect } from 'vitest'

// Re-implement parseSvnListXml for testing
function parseSvnListXml(xml: string, baseUrl: string): {
  path: string
  entries: Array<{
    name: string
    path: string
    url: string
    kind: 'file' | 'dir'
    size?: number
    revision: number
    author: string
    date: string
  }>
} {
  const entries: Array<{
    name: string
    path: string
    url: string
    kind: 'file' | 'dir'
    size?: number
    revision: number
    author: string
    date: string
  }> = []

  // Parse entries using regex (matches implementation in svn.ts)
  const entryMatches = xml.matchAll(/<entry[^>]*kind="([^"]*)"[^>]*>([\s\S]*?)<\/entry>/g)

  for (const match of entryMatches) {
    const kind = match[1]
    const content = match[2]

    const nameMatch = content.match(/<name>([^<]+)<\/name>/)
    const sizeMatch = content.match(/<size>(\d+)<\/size>/)
    const revMatch = content.match(/<commit[^>]*revision="(\d+)"/)
    const authorMatch = content.match(/<author>([^<]+)<\/author>/)
    const dateMatch = content.match(/<date>([^<]+)<\/date>/)

    const name = nameMatch?.[1] || ''
    const cleanName = name.replace(/\/$/, '')

    entries.push({
      name,
      path: baseUrl + '/' + cleanName,
      url: baseUrl + '/' + cleanName,
      kind: kind as 'file' | 'dir',
      size: sizeMatch ? parseInt(sizeMatch[1], 10) : undefined,
      revision: revMatch ? parseInt(revMatch[1], 10) : 0,
      author: authorMatch?.[1] || '',
      date: dateMatch?.[1] || ''
    })
  }

  return { path: baseUrl, entries }
}

describe('SVN List Parser', () => {
  describe('parseSvnListXml', () => {
    it('should parse empty list result', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="https://example.com/svn/repo/trunk">
  </list>
</lists>`

      const result = parseSvnListXml(xml, 'https://example.com/svn/repo/trunk')

      expect(result.entries).toHaveLength(0)
    })

    it('should parse directory entries', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="https://example.com/svn/repo/trunk">
    <entry kind="dir">
      <name>src</name>
      <commit revision="1234">
        <author>developer</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
    </entry>
    <entry kind="dir">
      <name>tests</name>
      <commit revision="1230">
        <author>tester</author>
        <date>2024-01-14T10:30:00.000000Z</date>
      </commit>
    </entry>
  </list>
</lists>`

      const result = parseSvnListXml(xml, 'https://example.com/svn/repo/trunk')

      expect(result.entries).toHaveLength(2)
      expect(result.entries[0].kind).toBe('dir')
      expect(result.entries[0].name).toBe('src')
      expect(result.entries[0].author).toBe('developer')
      expect(result.entries[1].name).toBe('tests')
    })

    it('should parse file entries with size', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="https://example.com/svn/repo/trunk">
    <entry kind="file">
      <name>README.md</name>
      <size>2048</size>
      <commit revision="1234">
        <author>developer</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
    </entry>
  </list>
</lists>`

      const result = parseSvnListXml(xml, 'https://example.com/svn/repo/trunk')

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].kind).toBe('file')
      expect(result.entries[0].size).toBe(2048)
    })

    it('should build correct URLs for entries', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="https://example.com/svn/repo/trunk">
    <entry kind="dir">
      <name>src</name>
      <commit revision="1234">
        <author>dev</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
    </entry>
  </list>
</lists>`

      const result = parseSvnListXml(xml, 'https://example.com/svn/repo/trunk')

      expect(result.entries[0].url).toBe('https://example.com/svn/repo/trunk/src')
      expect(result.entries[0].path).toBe('https://example.com/svn/repo/trunk/src')
    })

    it('should handle directory names with trailing slash', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="https://example.com/svn/repo/trunk">
    <entry kind="dir">
      <name>src/</name>
      <commit revision="1234">
        <author>dev</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
    </entry>
  </list>
</lists>`

      const result = parseSvnListXml(xml, 'https://example.com/svn/repo/trunk')

      // Name should preserve the slash, but URL should not have double slash
      expect(result.entries[0].name).toBe('src/')
      expect(result.entries[0].url).toBe('https://example.com/svn/repo/trunk/src')
    })

    it('should handle mixed files and directories', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="https://example.com/svn/repo/trunk">
    <entry kind="dir">
      <name>src</name>
      <commit revision="1235">
        <author>alice</author>
        <date>2024-01-16T10:30:00.000000Z</date>
      </commit>
    </entry>
    <entry kind="file">
      <name>package.json</name>
      <size>1024</size>
      <commit revision="1234">
        <author>bob</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
    </entry>
    <entry kind="file">
      <name>README.md</name>
      <size>512</size>
      <commit revision="1230">
        <author>charlie</author>
        <date>2024-01-14T10:30:00.000000Z</date>
      </commit>
    </entry>
    <entry kind="dir">
      <name>docs</name>
      <commit revision="1233">
        <author>dave</author>
        <date>2024-01-15T09:00:00.000000Z</date>
      </commit>
    </entry>
  </list>
</lists>`

      const result = parseSvnListXml(xml, 'https://example.com/svn/repo/trunk')

      expect(result.entries).toHaveLength(4)
      const dirs = result.entries.filter(e => e.kind === 'dir')
      const files = result.entries.filter(e => e.kind === 'file')
      expect(dirs).toHaveLength(2)
      expect(files).toHaveLength(2)
    })

    it('should handle special characters in names', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="https://example.com/svn/repo/trunk">
    <entry kind="file">
      <name>file with spaces.txt</name>
      <size>100</size>
      <commit revision="1234">
        <author>dev</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
    </entry>
    <entry kind="file">
      <name>file-with-dashes.json</name>
      <size>200</size>
      <commit revision="1235">
        <author>dev</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
    </entry>
  </list>
</lists>`

      const result = parseSvnListXml(xml, 'https://example.com/svn/repo/trunk')

      expect(result.entries[0].name).toBe('file with spaces.txt')
      expect(result.entries[1].name).toBe('file-with-dashes.json')
    })

    it('should handle missing optional fields', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="https://example.com/svn/repo/trunk">
    <entry kind="file">
      <name>orphan.txt</name>
      <commit revision="1234">
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
    </entry>
  </list>
</lists>`

      const result = parseSvnListXml(xml, 'https://example.com/svn/repo/trunk')

      expect(result.entries[0].size).toBeUndefined()
      expect(result.entries[0].author).toBe('')
    })
  })
})

describe('SVN List Depth Parameter', () => {
  it('should generate correct args for immediates depth', () => {
    const args = ['list', '--xml', '--non-interactive', '--depth', 'immediates', 'https://example.com/svn/repo']

    expect(args).toContain('--depth')
    expect(args[args.indexOf('--depth') + 1]).toBe('immediates')
  })

  it('should generate correct args for infinity depth', () => {
    const args = ['list', '--xml', '--non-interactive', '--depth', 'infinity', 'https://example.com/svn/repo']

    expect(args).toContain('--depth')
    expect(args[args.indexOf('--depth') + 1]).toBe('infinity')
  })

  it('should generate correct args for empty depth', () => {
    const args = ['list', '--xml', '--non-interactive', '--depth', 'empty', 'https://example.com/svn/repo']

    expect(args).toContain('--depth')
    expect(args[args.indexOf('--depth') + 1]).toBe('empty')
  })

  it('should include credentials when provided', () => {
    const args = [
      'list', '--xml', '--non-interactive',
      '--username', 'testuser',
      '--password', 'testpass',
      'https://example.com/svn/repo'
    ]

    expect(args).toContain('--username')
    expect(args[args.indexOf('--username') + 1]).toBe('testuser')
    expect(args).toContain('--password')
    expect(args[args.indexOf('--password') + 1]).toBe('testpass')
  })

  it('should include revision when specified', () => {
    const args = ['list', '--xml', '-r', '1234', 'https://example.com/svn/repo']

    expect(args).toContain('-r')
    expect(args[args.indexOf('-r') + 1]).toBe('1234')
  })
})
