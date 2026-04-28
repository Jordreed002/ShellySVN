import { describe, expect, it } from 'vitest';

import { parseSvnInfoSummaryXml, parseSvnStatusEntriesXml } from '../svn-xml';

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
});
