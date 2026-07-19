import { describe, expect, it } from 'vitest';
import { parseSvnChildCommitsXml } from '../../svn/parsers';

const XML = `<?xml version="1.0"?>
<info>
  <entry kind="dir" path="/wc/Clients" revision="100">
    <commit revision="100"><author>root</author><date>2026-01-01T00:00:00Z</date></commit>
  </entry>
  <entry kind="dir" path="/wc/Clients/ASE" revision="90">
    <commit revision="88"><author>ceri</author><date>2026-05-01T10:00:00Z</date></commit>
  </entry>
  <entry kind="file" path="/wc/Clients/readme.txt" revision="95">
    <commit revision="42"><author>ian</author><date>2026-03-02T12:00:00Z</date></commit>
  </entry>
</info>`;

describe('parseSvnChildCommitsXml', () => {
  it('maps immediate children to last-commit info and skips the directory itself', () => {
    const result = parseSvnChildCommitsXml(XML, '/wc/Clients');
    expect(result).toEqual({
      ASE: { revision: 88, author: 'ceri', date: '2026-05-01T10:00:00Z' },
      'readme.txt': { revision: 42, author: 'ian', date: '2026-03-02T12:00:00Z' },
    });
    expect(result.Clients).toBeUndefined();
  });

  it('handles a single-entry (no children) result', () => {
    const single = `<?xml version="1.0"?><info><entry kind="dir" path="/wc/Empty" revision="5"><commit revision="5"><author>a</author><date>d</date></commit></entry></info>`;
    expect(parseSvnChildCommitsXml(single, '/wc/Empty')).toEqual({});
  });

  it('returns an empty map for malformed XML', () => {
    expect(parseSvnChildCommitsXml('not xml', '/wc/x')).toEqual({});
  });
});
