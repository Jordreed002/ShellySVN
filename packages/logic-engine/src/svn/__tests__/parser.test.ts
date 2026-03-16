/**
 * Tests for SVN XML Parser
 *
 * Tests parsing of SVN status, log, and info XML outputs.
 */

import { describe, it, expect } from 'vitest';
import { parseSvnStatusXml, parseSvnLogXml, parseSvnInfoXml } from '../parser';

describe('parseSvnStatusXml', () => {
  describe('empty and invalid inputs', () => {
    it('should handle empty XML', () => {
      const result = parseSvnStatusXml('', '/test/path');
      expect(result.path).toBe('/test/path');
      expect(result.entries).toEqual([]);
      expect(result.revision).toBe(0);
    });

    it('should handle XML with no status element', () => {
      const xml = '<?xml version="1.0"?><root></root>';
      const result = parseSvnStatusXml(xml, '/test/path');
      expect(result.entries).toEqual([]);
    });

    it('should handle XML with no target', () => {
      const xml = '<?xml version="1.0"?><status></status>';
      const result = parseSvnStatusXml(xml, '/test/path');
      expect(result.entries).toEqual([]);
    });
  });

  describe('single entry parsing', () => {
    it('should parse a single modified file', () => {
      const xml = `<?xml version="1.0"?>
<status>
  <target path="/test/repo" revision="123">
    <entry path="src/main.ts">
      <wc-status item="modified" revision="122">
        <commit revision="120">
          <author>developer</author>
          <date>2024-01-15T10:30:00Z</date>
        </commit>
      </wc-status>
    </entry>
  </target>
</status>`;

      const result = parseSvnStatusXml(xml, '/test/repo');

      expect(result.path).toBe('/test/repo');
      expect(result.revision).toBe(123);
      expect(result.entries).toHaveLength(1);

      const entry = result.entries[0];
      expect(entry.path).toBe('src/main.ts');
      expect(entry.status).toBe('M');
      expect(entry.revision).toBe(120);
      expect(entry.author).toBe('developer');
      expect(entry.date).toBe('2024-01-15T10:30:00Z');
    });

    it('should parse a single added file', () => {
      const xml = `<?xml version="1.0"?>
<status>
  <target path="/test/repo">
    <entry path="src/newfile.ts">
      <wc-status item="added" revision="-1">
      </wc-status>
    </entry>
  </target>
</status>`;

      const result = parseSvnStatusXml(xml, '/test/repo');

      expect(result.entries[0].status).toBe('A');
    });

    it('should parse a deleted file', () => {
      const xml = `<?xml version="1.0"?>
<status>
  <target path="/test/repo">
    <entry path="src/oldfile.ts">
      <wc-status item="deleted">
      </wc-status>
    </entry>
  </target>
</status>`;

      const result = parseSvnStatusXml(xml, '/test/repo');

      expect(result.entries[0].status).toBe('D');
    });

    it('should parse a conflicted file', () => {
      const xml = `<?xml version="1.0"?>
<status>
  <target path="/test/repo">
    <entry path="src/conflicted.ts">
      <wc-status item="conflicted">
      </wc-status>
    </entry>
  </target>
</status>`;

      const result = parseSvnStatusXml(xml, '/test/repo');

      expect(result.entries[0].status).toBe('C');
    });

    it('should parse an unversioned file', () => {
      const xml = `<?xml version="1.0"?>
<status>
  <target path="/test/repo">
    <entry path="src/unversioned.ts">
      <wc-status item="unversioned">
      </wc-status>
    </entry>
  </target>
</status>`;

      const result = parseSvnStatusXml(xml, '/test/repo');

      expect(result.entries[0].status).toBe('?');
    });

    it('should parse a missing file', () => {
      const xml = `<?xml version="1.0"?>
<status>
  <target path="/test/repo">
    <entry path="src/missing.ts">
      <wc-status item="missing">
      </wc-status>
    </entry>
  </target>
</status>`;

      const result = parseSvnStatusXml(xml, '/test/repo');

      expect(result.entries[0].status).toBe('!');
    });
  });

  describe('multiple entries', () => {
    it('should parse multiple entries', () => {
      const xml = `<?xml version="1.0"?>
<status>
  <target path="/test/repo" revision="123">
    <entry path="src/main.ts">
      <wc-status item="modified">
      </wc-status>
    </entry>
    <entry path="src/utils.ts">
      <wc-status item="added">
      </wc-status>
    </entry>
    <entry path="src/old.ts">
      <wc-status item="deleted">
      </wc-status>
    </entry>
  </target>
</status>`;

      const result = parseSvnStatusXml(xml, '/test/repo');

      expect(result.entries).toHaveLength(3);
      expect(result.entries[0].status).toBe('M');
      expect(result.entries[1].status).toBe('A');
      expect(result.entries[2].status).toBe('D');
    });
  });

  describe('property status', () => {
    it('should parse property modifications', () => {
      const xml = `<?xml version="1.0"?>
<status>
  <target path="/test/repo">
    <entry path="src/main.ts">
      <wc-status item="normal" props="modified">
      </wc-status>
    </entry>
  </target>
</status>`;

      const result = parseSvnStatusXml(xml, '/test/repo');

      expect(result.entries[0].status).toBe(' ');
      expect(result.entries[0].propsStatus).toBe('M');
    });
  });
});

describe('parseSvnLogXml', () => {
  describe('empty and invalid inputs', () => {
    it('should handle empty XML', () => {
      const result = parseSvnLogXml('');
      expect(result.entries).toEqual([]);
      expect(result.startRevision).toBe(0);
      expect(result.endRevision).toBe(0);
    });

    it('should handle XML with no log entries', () => {
      const xml = '<?xml version="1.0"?><log></log>';
      const result = parseSvnLogXml(xml);
      expect(result.entries).toEqual([]);
    });
  });

  describe('single log entry', () => {
    it('should parse a single log entry', () => {
      const xml = `<?xml version="1.0"?>
<log>
  <logentry revision="123">
    <author>developer</author>
    <date>2024-01-15T10:30:00Z</date>
    <msg>Fix bug in authentication</msg>
    <paths>
      <path action="M">/trunk/src/auth.ts</path>
    </paths>
  </logentry>
</log>`;

      const result = parseSvnLogXml(xml);

      expect(result.entries).toHaveLength(1);
      expect(result.startRevision).toBe(123);
      expect(result.endRevision).toBe(123);

      const entry = result.entries[0];
      expect(entry.revision).toBe(123);
      expect(entry.author).toBe('developer');
      expect(entry.date).toBe('2024-01-15T10:30:00Z');
      expect(entry.message).toBe('Fix bug in authentication');
      expect(entry.paths).toHaveLength(1);
      expect(entry.paths[0].action).toBe('M');
      expect(entry.paths[0].path).toBe('/trunk/src/auth.ts');
    });

    it('should parse added path', () => {
      const xml = `<?xml version="1.0"?>
<log>
  <logentry revision="124">
    <author>developer</author>
    <date>2024-01-16T10:30:00Z</date>
    <msg>Add new feature</msg>
    <paths>
      <path action="A">/trunk/src/feature.ts</path>
    </paths>
  </logentry>
</log>`;

      const result = parseSvnLogXml(xml);
      expect(result.entries[0].paths[0].action).toBe('A');
    });

    it('should parse deleted path', () => {
      const xml = `<?xml version="1.0"?>
<log>
  <logentry revision="125">
    <author>developer</author>
    <date>2024-01-17T10:30:00Z</date>
    <msg>Remove deprecated code</msg>
    <paths>
      <path action="D">/trunk/src/deprecated.ts</path>
    </paths>
  </logentry>
</log>`;

      const result = parseSvnLogXml(xml);
      expect(result.entries[0].paths[0].action).toBe('D');
    });

    it('should parse replaced path', () => {
      const xml = `<?xml version="1.0"?>
<log>
  <logentry revision="126">
    <author>developer</author>
    <date>2024-01-18T10:30:00Z</date>
    <msg>Replace file</msg>
    <paths>
      <path action="R">/trunk/src/replaced.ts</path>
    </paths>
  </logentry>
</log>`;

      const result = parseSvnLogXml(xml);
      expect(result.entries[0].paths[0].action).toBe('R');
    });

    it('should parse copyfrom information', () => {
      const xml = `<?xml version="1.0"?>
<log>
  <logentry revision="127">
    <author>developer</author>
    <date>2024-01-19T10:30:00Z</date>
    <msg>Copy file</msg>
    <paths>
      <path action="A" copyfrom-path="/trunk/src/original.ts" copyfrom-rev="126">/trunk/src/copy.ts</path>
    </paths>
  </logentry>
</log>`;

      const result = parseSvnLogXml(xml);

      expect(result.entries[0].paths[0].copyFromPath).toBe('/trunk/src/original.ts');
      expect(result.entries[0].paths[0].copyFromRev).toBe(126);
    });
  });

  describe('multiple log entries', () => {
    it('should parse multiple log entries', () => {
      const xml = `<?xml version="1.0"?>
<log>
  <logentry revision="130">
    <author>dev1</author>
    <date>2024-01-20T10:30:00Z</date>
    <msg>Third commit</msg>
    <paths>
      <path action="M">/trunk/file3.ts</path>
    </paths>
  </logentry>
  <logentry revision="129">
    <author>dev2</author>
    <date>2024-01-19T10:30:00Z</date>
    <msg>Second commit</msg>
    <paths>
      <path action="M">/trunk/file2.ts</path>
    </paths>
  </logentry>
  <logentry revision="128">
    <author>dev1</author>
    <date>2024-01-18T10:30:00Z</date>
    <msg>First commit</msg>
    <paths>
      <path action="A">/trunk/file1.ts</path>
    </paths>
  </logentry>
</log>`;

      const result = parseSvnLogXml(xml);

      expect(result.entries).toHaveLength(3);
      expect(result.startRevision).toBe(128);
      expect(result.endRevision).toBe(130);
    });

    it('should parse multiple paths in single entry', () => {
      const xml = `<?xml version="1.0"?>
<log>
  <logentry revision="131">
    <author>developer</author>
    <date>2024-01-21T10:30:00Z</date>
    <msg>Multiple file changes</msg>
    <paths>
      <path action="M">/trunk/src/main.ts</path>
      <path action="A">/trunk/src/new.ts</path>
      <path action="D">/trunk/src/old.ts</path>
    </paths>
  </logentry>
</log>`;

      const result = parseSvnLogXml(xml);

      expect(result.entries[0].paths).toHaveLength(3);
    });
  });

  describe('edge cases', () => {
    it('should handle missing author', () => {
      const xml = `<?xml version="1.0"?>
<log>
  <logentry revision="132">
    <date>2024-01-22T10:30:00Z</date>
    <msg>No author</msg>
    <paths>
      <path action="M">/trunk/file.ts</path>
    </paths>
  </logentry>
</log>`;

      const result = parseSvnLogXml(xml);
      expect(result.entries[0].author).toBe('unknown');
    });

    it('should handle missing message', () => {
      const xml = `<?xml version="1.0"?>
<log>
  <logentry revision="133">
    <author>developer</author>
    <date>2024-01-23T10:30:00Z</date>
    <paths>
      <path action="M">/trunk/file.ts</path>
    </paths>
  </logentry>
</log>`;

      const result = parseSvnLogXml(xml);
      expect(result.entries[0].message).toBe('');
    });

    it('should handle entry with no paths', () => {
      const xml = `<?xml version="1.0"?>
<log>
  <logentry revision="134">
    <author>developer</author>
    <date>2024-01-24T10:30:00Z</date>
    <msg>No paths</msg>
  </logentry>
</log>`;

      const result = parseSvnLogXml(xml);
      expect(result.entries[0].paths).toEqual([]);
    });
  });
});

describe('parseSvnInfoXml', () => {
  describe('error handling', () => {
    it('should throw on empty XML', () => {
      expect(() => parseSvnInfoXml('')).toThrow('Failed to parse SVN info XML');
    });

    it('should throw on XML with no info element', () => {
      const xml = '<?xml version="1.0"?><root></root>';
      expect(() => parseSvnInfoXml(xml)).toThrow('Failed to parse SVN info XML');
    });
  });

  describe('valid info parsing', () => {
    it('should parse file info', () => {
      const xml = `<?xml version="1.0"?>
<info>
  <entry path="/test/repo/src/main.ts" revision="123" kind="file">
    <repository>
      <root>https://svn.example.com/repo</root>
      <uuid>12345678-1234-1234-1234-123456789012</uuid>
      <url>https://svn.example.com/repo/trunk/src/main.ts</url>
    </repository>
    <commit revision="120">
      <author>developer</author>
      <date>2024-01-15T10:30:00Z</date>
    </commit>
  </entry>
</info>`;

      const result = parseSvnInfoXml(xml);

      expect(result.path).toBe('/test/repo/src/main.ts');
      expect(result.url).toBe('https://svn.example.com/repo/trunk/src/main.ts');
      expect(result.repositoryRoot).toBe('https://svn.example.com/repo');
      expect(result.repositoryUuid).toBe('12345678-1234-1234-1234-123456789012');
      expect(result.revision).toBe(123);
      expect(result.nodeKind).toBe('file');
      expect(result.lastChangedAuthor).toBe('developer');
      expect(result.lastChangedRevision).toBe(120);
      expect(result.lastChangedDate).toBe('2024-01-15T10:30:00Z');
    });

    it('should parse directory info', () => {
      const xml = `<?xml version="1.0"?>
<info>
  <entry path="/test/repo" revision="123" kind="dir">
    <repository>
      <root>https://svn.example.com/repo</root>
      <uuid>12345678-1234-1234-1234-123456789012</uuid>
      <url>https://svn.example.com/repo/trunk</url>
    </repository>
    <commit revision="120">
      <author>developer</author>
      <date>2024-01-15T10:30:00Z</date>
    </commit>
  </entry>
</info>`;

      const result = parseSvnInfoXml(xml);

      expect(result.nodeKind).toBe('dir');
    });

    it('should parse working copy root', () => {
      const xml = `<?xml version="1.0"?>
<info>
  <wc-root-abspath>/test/repo</wc-root-abspath>
  <entry path="/test/repo/src" revision="123" kind="dir">
    <repository>
      <root>https://svn.example.com/repo</root>
      <uuid>12345678-1234-1234-1234-123456789012</uuid>
      <url>https://svn.example.com/repo/trunk/src</url>
    </repository>
    <commit revision="120">
      <author>developer</author>
      <date>2024-01-15T10:30:00Z</date>
    </commit>
  </entry>
</info>`;

      const result = parseSvnInfoXml(xml);

      expect(result.workingCopyRoot).toBe('/test/repo');
    });
  });

  describe('missing elements', () => {
    it('should handle missing repository info', () => {
      const xml = `<?xml version="1.0"?>
<info>
  <entry path="/test/repo" revision="123" kind="dir">
    <commit revision="120">
      <author>developer</author>
      <date>2024-01-15T10:30:00Z</date>
    </commit>
  </entry>
</info>`;

      const result = parseSvnInfoXml(xml);

      expect(result.url).toBe('');
      expect(result.repositoryRoot).toBe('');
    });

    it('should handle missing commit info', () => {
      const xml = `<?xml version="1.0"?>
<info>
  <entry path="/test/repo" revision="123" kind="dir">
    <repository>
      <root>https://svn.example.com/repo</root>
      <url>https://svn.example.com/repo/trunk</url>
    </repository>
  </entry>
</info>`;

      const result = parseSvnInfoXml(xml);

      expect(result.lastChangedAuthor).toBe('');
      expect(result.lastChangedRevision).toBe(0);
    });
  });
});
