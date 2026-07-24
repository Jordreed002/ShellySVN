import { describe, expect, it } from 'vitest';

import { parseSvnStatusXml } from '@shared/svn-parsers';
import { getCommitWarnings } from '../src/utils/commitWarnings';
import {
  getTextConflictPathsFromStatus,
  getTextConflictPathsFromSvnOutput,
} from '../src/utils/conflictDetection';

describe('text conflict detection', () => {
  it('detects text conflicts from SVN status XML', () => {
    const status = parseSvnStatusXml(
      `<?xml version="1.0"?>
      <status>
        <target path="/repo">
          <entry path="/repo/src/conflict.txt">
            <wc-status item="conflicted" />
          </entry>
          <entry path="/repo/src/clean.txt">
            <wc-status item="normal" />
          </entry>
        </target>
      </status>`,
      '/repo'
    );

    expect(getTextConflictPathsFromStatus(status.entries)).toEqual(['/repo/src/conflict.txt']);
  });

  it('promotes property-only conflicts to an actionable conflict status', () => {
    const status = parseSvnStatusXml(
      `<?xml version="1.0"?>
      <status>
        <target path="/repo">
          <entry path="/repo/src/property.txt">
            <wc-status item="modified" props="conflicted" />
          </entry>
        </target>
      </status>`,
      '/repo'
    );

    expect(status.entries[0]).toMatchObject({
      path: '/repo/src/property.txt',
      status: 'C',
      propsStatus: 'C',
    });
    expect(getTextConflictPathsFromStatus(status.entries)).toEqual(['/repo/src/property.txt']);
  });

  it('detects text conflicts from update and merge output lines', () => {
    expect(
      getTextConflictPathsFromSvnOutput(
        ['U    src/app.ts', 'C    src/conflict.txt', 'G    src/merged.txt'].join('\n')
      )
    ).toEqual(['src/conflict.txt']);

    expect(
      getTextConflictPathsFromSvnOutput(
        ['--- Merging r10 through r12 into .:', 'C docs/readme.md', ' U src/app.ts'].join('\n')
      )
    ).toEqual(['docs/readme.md']);
  });

  it('blocks commit flow warnings when selected files include text conflicts', () => {
    const warnings = getCommitWarnings([
      { path: '/repo/src/conflict.txt', status: 'C', selected: true },
      { path: '/repo/src/app.ts', status: 'M', selected: true },
    ]);

    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'conflicts',
          severity: 'danger',
          paths: ['/repo/src/conflict.txt'],
        }),
      ])
    );
  });
});
