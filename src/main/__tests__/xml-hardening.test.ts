import { describe, expect, it } from 'vitest';

import {
  SVN_XML_LIMITS,
  SvnXmlInputError,
  createSvnXmlParser,
  decodeSvnXmlEntities,
  parseSvnBlameEntriesXml,
  parseSvnInfoSummaryXml,
  parseSvnListEntriesXml,
  parseSvnPropertiesXml,
  parseSvnShelvesXml,
  parseSvnStatusEntriesXml,
} from '../utils/svn-xml';
import { parseSvnInfoXml } from '../svn/parsers';
import {
  parseSvnLogXml,
  parseSvnStatusXml,
} from '@shared/svn-parsers';

/**
 * A classic billion-laughs document that would expand to ~10^9 characters
 * (multiple GB) if entity expansion were enabled. With entity processing
 * disabled the references stay literal, so parsing is inert by construction.
 */
function billionLaughsXml(): string {
  const levels = 9;
  let entities = '  <!ENTITY lol "lol">\n';
  for (let i = 1; i <= levels; i += 1) {
    entities += `  <!ENTITY lol${i} "&lol${i - 1};&lol${i - 1};&lol${i - 1};&lol${i - 1};&lol${i - 1};&lol${i - 1};&lol${i - 1};&lol${i - 1};&lol${i - 1};&lol${i - 1};">\n`;
  }
  return `<?xml version="1.0"?>
<!DOCTYPE status [
${entities}]>
<status><target path="."><entry path="&lol${levels};"><wc-status item="modified"/></entry></target></status>`;
}

/** Many single references to distinct entities: the quadratic-blowup shape. */
function quadraticBlowupXml(count: number): string {
  const entities = Array.from(
    { length: count },
    (_, i) => `  <!ENTITY e${i} "payload-${i}">`
  ).join('\n');
  const references = Array.from({ length: count }, (_, i) => `&e${i};`).join('');
  return `<?xml version="1.0"?>
<!DOCTYPE log [
${entities}]>
<log><logentry revision="1"><author>dev</author><msg>${references}</msg></logentry></log>`;
}

const benignStatusXml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path=".">
    <entry path="src/A&amp;B.txt">
      <wc-status item="modified" revision="12">
        <commit revision="34">
          <author>alice &amp; bob</author>
        </commit>
      </wc-status>
    </entry>
  </target>
</status>`;

describe('hardened SVN XML parser: entity handling parity', () => {
  it('decodes the well-known five entities and their numeric aliases identically', () => {
    expect(decodeSvnXmlEntities('a&amp;b')).toBe('a&b');
    expect(decodeSvnXmlEntities('a&lt;b&gt;c')).toBe('a<b>c');
    expect(decodeSvnXmlEntities('&quot;q&quot; &apos;a&apos;')).toBe('"q" \'a\'');
    expect(decodeSvnXmlEntities('&#39;&#34;&#38;&#60;&#62;')).toBe('\'"&<>');
    expect(decodeSvnXmlEntities('&#x27;&#x22;&#x26;&#x3C;&#x3E;')).toBe('\'"&<>');
    expect(decodeSvnXmlEntities('&#x3c;&#x3e;')).toBe('<>');
  });

  it('does not double-decode nested entities', () => {
    expect(decodeSvnXmlEntities('&amp;lt;')).toBe('&lt;');
    expect(decodeSvnXmlEntities('&amp;amp;')).toBe('&amp;');
  });

  it('leaves unknown and malformed entity references literal', () => {
    expect(decodeSvnXmlEntities('&nbsp;&euro;&#x110000;&#9999999999;')).toBe(
      '&nbsp;&euro;&#x110000;&#9999999999;'
    );
    expect(decodeSvnXmlEntities('bare & ampersand')).toBe('bare & ampersand');
  });

  it('decodes entities in text nodes and attribute values after parsing', () => {
    const entries = parseSvnStatusEntriesXml(benignStatusXml);
    expect(entries).toEqual([
      { path: 'src/A&B.txt', item: 'modified', revision: 34, author: 'alice & bob' },
    ]);
  });

  it('keeps shared parser output identical for benign entity input', () => {
    const status = parseSvnStatusXml(benignStatusXml, '.');
    expect(status.entries[0].path).toBe('src/A&B.txt');
    expect(status.entries[0].author).toBe('alice & bob');

    const log = parseSvnLogXml(`<?xml version="1.0"?>
<log><logentry revision="7"><author>a &amp; b</author><msg>fix &lt;tag&gt; &quot;now&quot;</msg></logentry></log>`);
    expect(log.entries[0].author).toBe('a & b');
    expect(log.entries[0].message).toBe('fix <tag> "now"');
  });
});

describe('hardened SVN XML parser: entity expansion is inert', () => {
  it('does not expand billion-laughs entity declarations', () => {
    const entries = parseSvnStatusEntriesXml(billionLaughsXml());
    // The reference stays literal; nothing expanded anywhere in the output.
    expect(entries).toEqual([
      { path: '&lol9;', item: 'modified' },
    ]);
    expect(JSON.stringify(entries).length).toBeLessThan(200);
  });

  it('does not expand quadratic entity blowup declarations', () => {
    const log = parseSvnLogXml(quadraticBlowupXml(500));
    expect(log.entries).toHaveLength(1);
    // All 500 references remain literal and the message stays bounded.
    expect(log.entries[0].message).toBe(Array.from({ length: 500 }, (_, i) => `&e${i};`).join(''));
    expect(log.entries[0].message.length).toBeLessThan(10_000);
  });

  it('never resolves DOCTYPE SYSTEM entities (no external entity path)', () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE status [<!ENTITY ext SYSTEM "file:///etc/passwd">]>
<status><target path="."><entry path="&ext;"><wc-status item="normal"/></entry></target></status>`;
    // fast-xml-parser v5 refuses external entities outright; the failure is
    // a controlled error, never a fetch or an expansion.
    expect(() => createSvnXmlParser().parse(xml)).toThrow(/External entit/i);
    expect(parseSvnStatusEntriesXml(xml)).toEqual([]);
  });

  it('cannot re-enable processEntities via factory options', () => {
    const parser = createSvnXmlParser({
      processEntities: true,
    } as Parameters<typeof createSvnXmlParser>[0]);
    const parsed = parser.parse(
      `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x "EXPANDED">]><r>&x;</r>`
    ) as { r: string };
    expect(parsed.r).toBe('&x;');
  });
});

describe('hardened SVN XML parser: size and depth guards', () => {
  it('rejects nesting deeper than the documented bound before parsing', () => {
    const xml = '<a>'.repeat(SVN_XML_LIMITS.maxDepth + 1) + '</a>'.repeat(SVN_XML_LIMITS.maxDepth + 1);
    expect(() => createSvnXmlParser().parse(xml)).toThrow(SvnXmlInputError);
    expect(() => createSvnXmlParser().parse(xml)).toThrow(/nesting depth exceeds 64/);
  });

  it('accepts legitimate nesting depth (real SVN structures are ~6 deep)', () => {
    const xml = '<status><target path="."><entry path="f"><wc-status item="modified"><commit revision="1"><author>a</author></commit></wc-status></entry></target></status>';
    expect(() => createSvnXmlParser().parse(xml)).not.toThrow();
  });

  it('does not count self-closing tags towards depth (100k-file WC reality)', () => {
    const entries = Array.from(
      { length: 5000 },
      (_, i) => `<entry path="file-${i}.txt"><wc-status item="modified" props="none" revision="1"/></entry>`
    ).join('');
    const xml = `<?xml version="1.0"?><status><target path=".">${entries}</target></status>`;
    expect(parseSvnStatusEntriesXml(xml)).toHaveLength(5000);
  });

  it('does not count tags inside CDATA sections or comments towards depth', () => {
    const cdataPayload = `<r><![CDATA[${'<a>'.repeat(5000)}]]></r>`;
    expect(() => createSvnXmlParser().parse(cdataPayload)).not.toThrow();
    const commentPayload = `<r><!-- ${'<a>'.repeat(5000)} --></r>`;
    expect(() => createSvnXmlParser().parse(commentPayload)).not.toThrow();
  });

  it('rejects oversized single attribute values', () => {
    const huge = 'a'.repeat(SVN_XML_LIMITS.maxValueChars + 1);
    const xml = `<?xml version="1.0"?><status><target path="${huge}"></target></status>`;
    expect(() => createSvnXmlParser().parse(xml)).toThrow(
      /exceeds \d+ characters \(possible hostile input\)/
    );
  });

  it('rejects oversized single text nodes (CDATA bomb)', () => {
    const huge = 'x'.repeat(SVN_XML_LIMITS.maxValueChars + 1);
    const xml = `<?xml version="1.0"?><properties><target path="."><property name="p"><![CDATA[${huge}]]></property></target></properties>`;
    expect(() => createSvnXmlParser().parse(xml)).toThrow(/possible hostile input/);
  });

  it('rejects oversized text nodes built from plain characters', () => {
    const huge = 'y'.repeat(SVN_XML_LIMITS.maxValueChars + 1);
    const xml = `<?xml version="1.0"?><msg>${huge}</msg>`;
    expect(() => createSvnXmlParser().parse(xml)).toThrow(/possible hostile input/);
  });

  it('accepts large-but-bounded property values (svn:mergeinfo scale)', () => {
    const big = '/branches/feature:1-12345\n'.repeat(20_000); // ~540 KB
    const xml = `<?xml version="1.0"?><properties><target path="."><property name="svn:mergeinfo">${big}</property></target></properties>`;
    const properties = parseSvnPropertiesXml(xml);
    expect(properties[0].name).toBe('svn:mergeinfo');
    expect(properties[0].value.length).toBe(big.length);
  });

  it('rejects inputs over the total size cap without parsing them', () => {
    const huge = 'x'.repeat(SVN_XML_LIMITS.maxInputChars + 1);
    expect(() => createSvnXmlParser().parse(huge)).toThrow(/exceeds the \d+ character limit/);
  });

  it('parses a 100k-entry status document well inside the caps', () => {
    const entries = Array.from(
      { length: 100_000 },
      (_, i) =>
        `<entry path="dir/file-${i}.txt"><wc-status item="modified" props="none" revision="5"><commit revision="3"><author>user</author><date>2024-01-01T12:00:00.000000Z</date></commit></wc-status></entry>`
    ).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<status>\n<target path="/test/repo">\n${entries}\n</target>\n</status>\n`;
    // ~20 MB of XML for a 100k-file working copy: comfortably under 128 MiB.
    expect(xml.length).toBeGreaterThan(15_000_000);
    expect(xml.length).toBeLessThan(SVN_XML_LIMITS.maxInputChars);
    const parsed = parseSvnStatusEntriesXml(xml);
    expect(parsed).toHaveLength(100_000);
    expect(parsed[99_999]).toMatchObject({ path: 'dir/file-99999.txt', item: 'modified' });
  }, 30_000);
});

describe('hardened SVN XML parser: malformed and hostile bytes', () => {
  it('rejects null bytes', () => {
    const xml = '<?xml version="1.0"?><status>\u0000</status>';
    expect(() => createSvnXmlParser().parse(xml)).toThrow(/null byte/);
  });

  it('rejects non-string input with a controlled error', () => {
    expect(() => createSvnXmlParser().parse(undefined as unknown as string)).toThrow(
      SvnXmlInputError
    );
    expect(() => createSvnXmlParser().parse(null as unknown as string)).toThrow(
      /must be a string/
    );
  });

  it('bounds invalid UTF-8-ish strings (lone surrogates, control characters)', () => {
    const xml = '<?xml version="1.0"?><status><target path=".">\uD800\uFFFD\u0001</target></status>';
    expect(() => createSvnXmlParser().parse(xml)).not.toThrow();
  });

  it('handles truncated XML mid-stream without crashing', () => {
    const full = `<?xml version="1.0" encoding="UTF-8"?>
<status>
  <target path="/test/repo">
    <entry path="a.txt"><wc-status item="modified"/></entry>
    <entry path="b.txt"><wc-status item="added"><commit revision="9"><author>x</author>`;
    for (const cut of [full.length - 30, Math.floor(full.length / 2), 20]) {
      const truncated = full.slice(0, cut);
      expect(Array.isArray(parseSvnStatusEntriesXml(truncated))).toBe(true);
      const shared = parseSvnStatusXml(truncated, '/test/repo');
      expect(Array.isArray(shared.entries)).toBe(true);
    }
  });

  it('does not pollute Object.prototype via crafted tag or attribute names', () => {
    const xml = `<?xml version="1.0"?><root><__proto__>pwn</__proto__><entry __proto__="x" path="ok"/></root>`;
    const parsed = createSvnXmlParser().parse(xml) as Record<string, unknown>;
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(({} as { polluted?: string }).polluted).toBeUndefined();
  });
});

describe('hardened SVN XML parser: error-shape compatibility', () => {
  it('maps hostile input onto the established fallback shapes of every helper', () => {
    const hostile = billionLaughsXml();
    expect(parseSvnStatusEntriesXml(hostile)).toEqual([
      { path: '&lol9;', item: 'modified' },
    ]);
    expect(parseSvnInfoSummaryXml('<info>\u0000</info>')).toBeNull();
    expect(parseSvnBlameEntriesXml('<blame>'.repeat(100))).toEqual([]);
    expect(parseSvnListEntriesXml('<lists>'.repeat(100))).toEqual([]);
    expect(parseSvnShelvesXml('<shelves>\u0000</shelves>')).toEqual([]);
    expect(parseSvnPropertiesXml('<properties>'.repeat(100))).toEqual([]);
  });

  it('surfaces parseError strings (not throws) from the shared and main parsers', () => {
    const hostile = '<a>'.repeat(SVN_XML_LIMITS.maxDepth + 1);
    const status = parseSvnStatusXml(hostile, '.');
    expect(status.path).toBe('.');
    expect(status.entries).toEqual([]);
    expect(status.parseError).toMatch(/nesting depth exceeds 64/);

    const log = parseSvnLogXml(hostile);
    expect(log.entries).toEqual([]);
    expect(log.parseError).toMatch(/nesting depth exceeds 64/);

    const info = parseSvnInfoXml('<info>\u0000</info>');
    expect(info.path).toBe('');
    expect(info.parseError).toMatch(/null byte/);
  });
});
