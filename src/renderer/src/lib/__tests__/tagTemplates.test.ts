import { describe, expect, it } from 'vitest';

import {
  TAG_TEMPLATE_PRESETS,
  applyTagTemplate,
  buildSvnCopyCommand,
  bumpSemver,
  defaultTagCommitMessage,
  detectLatestVersion,
  extractVersionFromRenderedName,
  joinTagUrl,
  parseSemver,
  suggestBumpedName,
  validateTagName,
} from '../tagTemplates';

describe('tag template presets', () => {
  it('ships the mission presets', () => {
    expect(TAG_TEMPLATE_PRESETS.map((preset) => preset.label)).toEqual([
      'release/x.y.z',
      'x.y.z',
      'tags/#{rev}',
      'Custom…',
    ]);
  });
});

describe('applyTagTemplate', () => {
  it('substitutes version and rev placeholders case-insensitively', () => {
    expect(applyTagTemplate('release/{version}', { version: '1.2.3' })).toBe('release/1.2.3');
    expect(applyTagTemplate('tags/#{rev}', { rev: 1234 })).toBe('tags/#1234');
    expect(applyTagTemplate('build-{Version}-r{REV}', { version: '2.0.0', rev: 7 })).toBe(
      'build-2.0.0-r7'
    );
  });

  it('leaves unknown contexts as empty strings', () => {
    expect(applyTagTemplate('release/{version}', {})).toBe('release/');
  });
});

describe('parseSemver / bumpSemver', () => {
  it('parses plain, v-prefixed, prerelease and build versions', () => {
    expect(parseSemver('1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver('v1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver('1.0.0-rc.1+build.5')).toMatchObject({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: 'rc.1',
      build: 'build.5',
    });
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('latest')).toBeNull();
  });

  it('bumps components and resets the tail', () => {
    expect(bumpSemver('1.2.3', 'major')).toBe('2.0.0');
    expect(bumpSemver('1.2.3', 'minor')).toBe('1.3.0');
    expect(bumpSemver('1.2.3-rc.1', 'patch')).toBe('1.2.4');
    expect(bumpSemver('nope', 'patch')).toBeNull();
  });
});

describe('validateTagName', () => {
  it('accepts valid semver names for version templates', () => {
    expect(validateTagName('release/{version}', 'release/1.2.3', {})).toMatchObject({
      valid: true,
      version: '1.2.3',
    });
    expect(validateTagName('{version}', '0.10.4', { version: '0.10.4' })).toMatchObject({
      valid: true,
    });
  });

  it('rejects invalid semver in version templates', () => {
    expect(validateTagName('release/{version}', 'release/tomorrow', {}).valid).toBe(false);
    expect(validateTagName('{version}', '1.2', {}).valid).toBe(false);
  });

  it('enforces path shape rules for every template', () => {
    expect(validateTagName('tags/#{rev}', 'has space', { rev: 5 }).valid).toBe(false);
    expect(validateTagName('tags/#{rev}', '/leading', {}).valid).toBe(false);
    expect(validateTagName('tags/#{rev}', 'trailing/', {}).valid).toBe(false);
    expect(validateTagName('tags/#{rev}', 'a//b', {}).valid).toBe(false);
    expect(validateTagName('tags/#{rev}', '', {}).error).toBe('Enter a tag name');
    expect(validateTagName('tags/#{rev}', 'tags/#55', { rev: 55 })).toMatchObject({ valid: true });
  });
});

describe('version detection', () => {
  it('extracts the version slot back out of rendered names', () => {
    expect(extractVersionFromRenderedName('release/{version}', 'release/1.4.0')).toBe('1.4.0');
    expect(extractVersionFromRenderedName('{version}', '2.1.0')).toBe('2.1.0');
    expect(extractVersionFromRenderedName('tags/#{rev}', 'tags/#12')).toBeNull();
  });

  it('detects the latest version among existing tags', () => {
    const names = ['release/1.2.0', 'release/1.10.0', 'release/1.9.3', 'release-notes.txt'];
    expect(detectLatestVersion(names, 'release/{version}')).toBe('1.10.0');
    expect(detectLatestVersion(['2.0.0', '2.0.1'], '{version}')).toBe('2.0.1');
    expect(detectLatestVersion(['not-a-version'], '{version}')).toBeNull();
  });

  it('suggests bumped names from the latest detected tag', () => {
    expect(suggestBumpedName('release/{version}', '1.2.3', 55, 'major')).toBe('release/2.0.0');
    expect(suggestBumpedName('release/{version}', '1.2.3', 55, 'patch')).toBe('release/1.2.4');
    expect(suggestBumpedName('release/{version}', null, 55, 'minor')).toBe('release/0.1.0');
    expect(suggestBumpedName('tags/#{rev}', null, 9, 'patch')).toBe('tags/#9');
  });
});

describe('joinTagUrl', () => {
  it('avoids double slashes and keeps bare destinations', () => {
    expect(joinTagUrl('svn://host/repo/tags/', 'release/1.0.0')).toBe(
      'svn://host/repo/tags/release/1.0.0'
    );
    expect(joinTagUrl('svn://host/repo', 'tags/1.0.0')).toBe('svn://host/repo/tags/1.0.0');
    expect(joinTagUrl('svn://host/repo/tags', '')).toBe('svn://host/repo/tags');
  });
});

describe('defaultTagCommitMessage', () => {
  it('pre-fills "Tag {version} from {source}@r{rev}"', () => {
    expect(defaultTagCommitMessage('1.2.3', '^/trunk', 4242)).toBe('Tag 1.2.3 from ^/trunk@r4242');
    expect(defaultTagCommitMessage('0.1.0', 'trunk', undefined)).toBe('Tag 0.1.0 from trunk');
  });
});

describe('buildSvnCopyCommand', () => {
  it('renders the exact command with revision and message', () => {
    expect(
      buildSvnCopyCommand({
        source: 'svn://host/repo/trunk',
        revision: 4242,
        destinationUrl: 'svn://host/repo/tags/release/1.2.3',
        message: 'Tag 1.2.3 from trunk@r4242',
        fromWorkingCopy: false,
      })
    ).toBe(
      'svn copy svn://host/repo/trunk@4242 svn://host/repo/tags/release/1.2.3 -m "Tag 1.2.3 from trunk@r4242"'
    );
  });

  it('omits the revision for HEAD and quotes arguments with spaces', () => {
    expect(
      buildSvnCopyCommand({
        source: 'svn://host/repo/trunk',
        revision: 'HEAD',
        destinationUrl: 'svn://host/repo/tags/1.0.0',
        message: 'simple message',
        fromWorkingCopy: false,
      })
    ).toBe('svn copy svn://host/repo/trunk svn://host/repo/tags/1.0.0 -m "simple message"');
  });

  it('uses the plain source for working-copy copies', () => {
    expect(
      buildSvnCopyCommand({
        source: 'C:/wc/trunk',
        revision: 'WORKING',
        destinationUrl: 'svn://host/repo/tags/1.0.0',
        message: 'm',
        fromWorkingCopy: true,
      })
    ).toBe('svn copy C:/wc/trunk@WORKING svn://host/repo/tags/1.0.0 -m m');
  });
});
