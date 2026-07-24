import { describe, expect, it } from 'vitest';

import {
  parseSvnBlameEntriesXml,
  parseSvnInfoSummaryXml,
  parseSvnListEntriesXml,
  parseSvnPropertiesXml,
  parseSvnShelvesXml,
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

  it('parses changelist names from status entries', () => {
    const entries = parseSvnStatusEntriesXml(`<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
    <entry path="src/feature.txt">
      <wc-status item="modified" />
      <changelist>release &amp; docs</changelist>
    </entry>
  </target>
</status>`);

    expect(entries[0]).toMatchObject({
      path: 'src/feature.txt',
      item: 'modified',
      changelist: 'release & docs',
    });
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

  it('parses shelves and properties with decoded values', () => {
    const shelves = parseSvnShelvesXml(`<?xml version="1.0" encoding="UTF-8"?>
<shelves>
  <shelf name="wip &amp; docs">
    <path>C:/work/repo</path>
    <date>2024-01-15T10:30:00.000000Z</date>
  </shelf>
</shelves>`);

    expect(shelves).toEqual([
      {
        name: 'wip & docs',
        path: 'C:/work/repo',
        date: '2024-01-15T10:30:00.000000Z',
      },
    ]);

    const properties = parseSvnPropertiesXml(`<?xml version="1.0" encoding="UTF-8"?>
<properties>
  <target path=".">
    <property name="svn:ignore">*.o
build &amp; dist</property>
  </target>
</properties>`);

    expect(properties).toEqual([
      {
        name: 'svn:ignore',
        value: '*.o\nbuild & dist',
      },
    ]);

    expect(
      parseSvnPropertiesXml(`<?xml version="1.0" encoding="UTF-8"?>
<properties>
  <target path="https://svn.example.com/repo/trunk">
    <inherited_property name="svn:mergeinfo">/branches/feature:1-3</inherited_property>
  </target>
  <target path="https://svn.example.com/repo/trunk/child">
    <property name="custom:owner">team</property>
  </target>
</properties>`)
    ).toEqual([
      {
        name: 'svn:mergeinfo',
        value: '/branches/feature:1-3',
        inherited: true,
        inheritedFrom: 'https://svn.example.com/repo/trunk',
      },
      { name: 'custom:owner', value: 'team' },
    ]);
  });
});
