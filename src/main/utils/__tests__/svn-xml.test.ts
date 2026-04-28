import { describe, expect, it } from 'vitest';

import {
  parseSvnBlameEntriesXml,
  parseSvnInfoSummaryXml,
  parseSvnListEntriesXml,
  parseSvnStatusEntriesXml,
} from '../svn-xml';

describe('SVN XML parser helpers', () => {
  it('parses status entries with decoded XML entities and commit metadata', () => {
    const entries = parseSvnStatusEntriesXml(`<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path="C:/work/repo">
    <entry path="C:/work/repo/src/A&amp;B.txt">
      <wc-status item="modified" revision="12">
        <commit revision="34">
          <author>alice &amp; bob</author>
        </commit>
      </wc-status>
    </entry>
  </target>
</status>`);

    expect(entries).toEqual([
      {
        path: 'C:/work/repo/src/A&B.txt',
        item: 'modified',
        revision: 34,
        author: 'alice & bob',
      },
    ]);
  });

  it('normalizes single status entries and malformed status XML safely', () => {
    const singleEntry = parseSvnStatusEntriesXml(`<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
    <entry path="new-file.txt">
      <wc-status item="unversioned" />
    </entry>
  </target>
</status>`);

    expect(singleEntry).toEqual([{ path: 'new-file.txt', item: 'unversioned' }]);
    expect(parseSvnStatusEntriesXml('not xml')).toEqual([]);
  });

  it('parses SVN info summaries and malformed info XML safely', () => {
    const info = parseSvnInfoSummaryXml(`<?xml version="1.0" encoding="UTF-8"?>
<info>
  <entry path="." revision="1234" kind="dir">
    <url>https://example.com/svn/A&amp;B</url>
  </entry>
</info>`);

    expect(info).toEqual({
      url: 'https://example.com/svn/A&B',
      revision: 1234,
    });
    expect(parseSvnInfoSummaryXml('not xml')).toBeNull();
  });

  it('parses blame entries with decoded entities and preserves leading text whitespace', () => {
    const lines = parseSvnBlameEntriesXml(`<?xml version="1.0" encoding="UTF-8"?>
<blame>
  <target path="src/file.ts">
    <entry line-number="7">
      <commit revision="42">
        <author>alice</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
      <text>  const label = "A&amp;B";</text>
    </entry>
  </target>
</blame>`);

    expect(lines).toEqual([
      {
        lineNumber: 7,
        revision: 42,
        author: 'alice',
        date: '2024-01-15T10:30:00.000000Z',
        content: '  const label = "A&B";',
      },
    ]);
  });

  it('parses list entries with decoded names and optional file sizes', () => {
    const entries = parseSvnListEntriesXml(`<?xml version="1.0" encoding="UTF-8"?>
<lists>
  <list path="https://example.com/svn/repo/trunk">
    <entry kind="file">
      <name>A&amp;B.txt</name>
      <size>2048</size>
      <commit revision="1234">
        <author>developer</author>
        <date>2024-01-15T10:30:00.000000Z</date>
      </commit>
    </entry>
  </list>
</lists>`);

    expect(entries).toEqual([
      {
        name: 'A&B.txt',
        kind: 'file',
        size: 2048,
        revision: 1234,
        author: 'developer',
        date: '2024-01-15T10:30:00.000000Z',
      },
    ]);
  });
});
