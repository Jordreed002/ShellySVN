/**
 * Integration tests for SVN parsing functions from svn.ts
 *
 * These tests directly test the exported parsing functions to ensure
 * actual coverage of the production code.
 */

import { describe, it, expect } from 'vitest'
import {
  parseSvnStatusXml,
  parseSvnInfoXml,
  parseSvnLogXml,
  parseSvnDiff,
  parseSvnListXml,
  parseSvnBlameXml
} from '@main/ipc/svn'

describe('SVN Parsing Functions Integration', () => {
  describe('parseSvnStatusXml', () => {
    it('should parse empty status', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
  </target>
</status>`

      const result = parseSvnStatusXml(xml, '/test')

      expect(result.path).toBe('/test')
      expect(result.entries).toHaveLength(0)
    })

    it('should parse modified files', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
    <entry path="src/file.ts">
      <wc-status item="modified">
        <commit revision="1234">
          <author>developer</author>
          <date>2024-01-15T10:30:00.000000Z</date>
        </commit>
      </wc-status>
    </entry>
  </target>
</status>`

      const result = parseSvnStatusXml(xml, '/test')

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].path).toBe('src/file.ts')
      expect(result.entries[0].status).toBe('modified')
      expect(result.entries[0].revision).toBe(1234)
      expect(result.entries[0].author).toBe('developer')
    })

    it('should handle malformed XML', () => {
      const result = parseSvnStatusXml('not xml', '/test')

      expect(result.entries).toHaveLength(0)
      expect(result.path).toBe('/test')
    })

    it('should parse multiple entries', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
    <entry path="file1.ts">
      <wc-status item="added">
      </wc-status>
    </entry>
    <entry path="file2.ts">
      <wc-status item="deleted">
      </wc-status>
    </entry>
    <entry path="file3.ts">
      <wc-status item="modified">
      </wc-status>
    </entry>
  </target>
</status>`

      const result = parseSvnStatusXml(xml, '/test')

      expect(result.entries).toHaveLength(3)
      expect(result.entries[0].status).toBe('added')
      expect(result.entries[1].status).toBe('deleted')
      expect(result.entries[2].status).toBe('modified')
    })
  })

  describe('parseSvnInfoXml', () => {
    it('should parse basic info', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<info>
  <entry path="." revision="1234" kind="dir">
    <url>https://example.com/svn/repo/trunk</url>
    <repository>
      <root>https://example.com/svn/repo</root>
      <uuid>test-uuid-1234</uuid>
    </repository>
    <wcroot-abspath>/path/to/wc</wcroot-abspath>
    <commit revision="1233">
      <author>developer</author>
      <date>2024-01-15T10:30:00.000000Z</date>
    </commit>
  </entry>
</info>`

      const result = parseSvnInfoXml(xml)

      expect(result.path).toBe('.')
      expect(result.revision).toBe(1234)
      expect(result.url).toBe('https://example.com/svn/repo/trunk')
      expect(result.repositoryRoot).toBe('https://example.com/svn/repo')
      expect(result.repositoryUuid).toBe('test-uuid-1234')
      expect(result.workingCopyRoot).toBe('/path/to/wc')
      expect(result.lastChangedRevision).toBe(1233)
      expect(result.lastChangedAuthor).toBe('developer')
    })

    it('should handle missing working copy root', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<info>
  <entry path="." revision="1234" kind="dir">
    <url>https://example.com/svn/repo/trunk</url>
    <repository>
      <root>https://example.com/svn/repo</root>
      <uuid>test-uuid</uuid>
    </repository>
    <commit revision="1233">
      <author>dev</author>
      <date>2024-01-15T10:30:00.000000Z</date>
    </commit>
  </entry>
</info>`

      const result = parseSvnInfoXml(xml)

      expect(result.workingCopyRoot).toBeUndefined()
    })

    it('should handle malformed XML', () => {
      const result = parseSvnInfoXml('not xml')

      expect(result.path).toBe('')
      expect(result.revision).toBe(0)
    })
  })

  describe('parseSvnLogXml', () => {
    it('should parse log entries', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="1234">
    <author>developer</author>
    <date>2024-01-15T10:30:00.000000Z</date>
    <msg>Test commit</msg>
  </logentry>
</log>`

      const result = parseSvnLogXml(xml)

      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].revision).toBe(1234)
      expect(result.entries[0].author).toBe('developer')
      expect(result.entries[0].message).toBe('Test commit')
      expect(result.startRevision).toBe(1234)
      expect(result.endRevision).toBe(1234)
    })

    it('should parse entries with paths', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <logentry revision="1234">
    <author>dev</author>
    <date>2024-01-15T10:30:00.000000Z</date>
    <msg>Changes</msg>
    <paths>
      <path action="A" kind="file">/trunk/src/new.ts</path>
      <path action="M" kind="file">/trunk/src/existing.ts</path>
    </paths>
  </logentry>
</log>`

      const result = parseSvnLogXml(xml)

      expect(result.entries[0].paths).toHaveLength(2)
      expect(result.entries[0].paths[0].action).toBe('A')
      expect(result.entries[0].paths[1].action).toBe('M')
    })

    it('should handle empty log', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
</log>`

      const result = parseSvnLogXml(xml)

      expect(result.entries).toHaveLength(0)
    })
  })

  describe('parseSvnDiff', () => {
    it('should parse empty diff', () => {
      const result = parseSvnDiff('')

      expect(result.files).toHaveLength(0)
      expect(result.hasChanges).toBe(false)
    })

    it('should parse binary diff', () => {
      const result = parseSvnDiff('Cannot display: file marked as a binary type.')

      expect(result.isBinary).toBe(true)
      expect(result.hasChanges).toBe(true)
    })

    it('should parse file diff', () => {
      const diff = `Index: file.ts
===================================================================
--- file.ts\t(revision 1234)
+++ file.ts\t(working copy)
@@ -1,3 +1,4 @@
 line1
+new line
 line2`

      const result = parseSvnDiff(diff)

      expect(result.files).toHaveLength(1)
      expect(result.files[0].oldPath).toBe('file.ts\t(revision 1234)')
      expect(result.files[0].newPath).toBe('file.ts\t(working copy)')
      expect(result.files[0].hunks).toHaveLength(1)
      expect(result.hasChanges).toBe(true)
    })

    it('should track line types', () => {
      const diff = `Index: file.ts
===================================================================
--- file.ts
+++ file.ts
@@ -1,2 +1,3 @@
 context
-removed
+added`

      const result = parseSvnDiff(diff)

      const lines = result.files[0].hunks[0].lines
      const added = lines.filter(l => l.type === 'added')
      const removed = lines.filter(l => l.type === 'removed')
      const context = lines.filter(l => l.type === 'context')

      expect(added).toHaveLength(1)
      expect(removed).toHaveLength(1)
      expect(context.length).toBeGreaterThan(0)
    })
  })

  describe('parseSvnListXml', () => {
    it('should parse list entries', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="https://repo/path">
    <entry kind="dir">
      <name>src</name>
      <commit revision="1234">
        <author>dev</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
    </entry>
    <entry kind="file">
      <name>README.md</name>
      <size>1024</size>
      <commit revision="1230">
        <author>dev</author>
        <date>2024-01-14T10:30:00.000000Z</date>
      </commit>
    </entry>
  </list>
</lists>`

      const result = parseSvnListXml(xml, 'https://repo/path')

      expect(result.entries).toHaveLength(2)
      expect(result.entries[0].kind).toBe('dir')
      expect(result.entries[0].name).toBe('src')
      expect(result.entries[1].kind).toBe('file')
      expect(result.entries[1].size).toBe(1024)
    })
  })

  describe('parseSvnBlameXml', () => {
    it('should parse blame output', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<blame>
  <target path="test.txt">
    <entry line-number="1">
      <commit revision="1234">
        <author>dev</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
      <text>First line</text>
    </entry>
    <entry line-number="2">
      <commit revision="1235">
        <author>alice</author>
        <date>2024-01-16T10:30:00.000000Z</date>
      </commit>
      <text>Second line</text>
    </entry>
  </target>
</blame>`

      const result = parseSvnBlameXml(xml, 'test.txt')

      expect(result.lines).toHaveLength(2)
      expect(result.lines[0].lineNumber).toBe(1)
      expect(result.lines[0].revision).toBe(1234)
      expect(result.lines[0].author).toBe('dev')
      expect(result.lines[0].content).toBe('First line')
      expect(result.startRevision).toBe(1234)
      expect(result.endRevision).toBe(1235)
    })
  })
})
