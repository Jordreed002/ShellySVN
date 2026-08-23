import { describe, expect, it } from 'vitest';

import {
  forAll,
  genArray,
  genConstant,
  genInt,
  genMap,
  genOneOf,
  genOptional,
  genPick,
  genRecord,
  genUnicodeString,
  type Generator,
} from '@test-utils/propertyCheck';

import {
  formatExternalDefinition,
  formatSvnExternals,
  isValidExternalRevision,
  isValidExternalUrl,
  parseSvnExternals,
  validateExternalFields,
  type SvnExternalDefinition,
  type SvnExternalsWarningCode,
} from '../svnExternals';

/*
 * Property tests for the svn:externals parser/formatter (item #130):
 * generated *valid* definitions must survive format → parse with identical
 * semantics, full multi-line values must round-trip losslessly (modulo the
 * documented legacy → modern normalization), and hostile input must never
 * throw.
 */

const URL_SCHEMES = ['http', 'https', 'svn', 'svn+ssh', 'file'] as const;
const PATH_WORDS = ['vendor', 'deps', 'lib', 'third', 'ext', 'sub', 'a.b', 'd1r', 'x'] as const;
const REVISIONS = ['1', '42', '0', '1234', 'HEAD', 'head', 'Head', '{2020-01-01}', '{t}'] as const;

const genUrlPath = genMap(
  genArray(genPick(PATH_WORDS), { min: 1, max: 3 }),
  (segments) => segments.join('/')
);

/** Every URL form svn:externals accepts; never contains whitespace. */
const genUrl: Generator<string> = genOneOf(
  genMap(
    genRecord({ scheme: genPick(URL_SCHEMES), host: genPick(PATH_WORDS), path: genUrlPath }),
    ({ scheme, host, path }) => `${scheme}://${host}/${path}`
  ),
  genMap(genUrlPath, (path) => `^/${path}`),
  genMap(genUrlPath, (path) => `//server/${path}`),
  genMap(genUrlPath, (path) => `/repo/${path}`),
  genMap(genUrlPath, (path) => `../${path}`),
  genMap(genUrlPath, (path) => `./${path}`)
);

/** Relative local path: non-empty segments, no `..`, no separators at start. */
const genLocalPath = genMap(
  genArray(genPick(PATH_WORDS), { min: 1, max: 3 }),
  (segments) => segments.join('/')
);

const genDefinition = genRecord({
  localPath: genLocalPath,
  url: genUrl,
  operativeRevision: genOptional(genPick(REVISIONS), 0.4),
  pegRevision: genOptional(genPick(REVISIONS), 0.3),
});

const withPeg = (definition: SvnExternalDefinition): string =>
  definition.pegRevision ? `${definition.url}@${definition.pegRevision}` : definition.url;

/** Serialize a definition in either layout, with split or attached `-r`. */
function serializeDefinition(
  definition: SvnExternalDefinition,
  legacy: boolean,
  attachedRev: boolean
): string {
  const revision = definition.operativeRevision
    ? attachedRev
      ? `-r${definition.operativeRevision}`
      : `-r ${definition.operativeRevision}`
    : '';
  const url = withPeg(definition);
  return legacy
    ? `${definition.localPath}${revision ? ` ${revision}` : ''} ${url}`
    : `${url}${revision ? ` ${revision}` : ''} ${definition.localPath}`;
}

function warningCodes(warnings: ReadonlyArray<{ code: SvnExternalsWarningCode }>): string[] {
  return warnings.map((warning) => warning.code);
}

describe('parseSvnExternals / formatSvnExternals properties', () => {
  it('formatExternalDefinition output re-parses to the identical definition', () => {
    forAll(
      genDefinition,
      (definition) => {
        // Out-of-domain shrink candidates (dropped/empty fields) are not
        // counterexamples — treat them as passing.
        if (!definition?.localPath || !definition?.url) return true;
        const line = formatExternalDefinition(definition);
        const parsed = parseSvnExternals(line);
        const first = parsed.lines[0];
        if (first?.kind !== 'definition') return false;
        expect(parsed.lines).toHaveLength(1);
        // toEqual (not toStrictEqual): absent peg/operative revisions are
        // `undefined` keys on the generated record but omitted keys on the
        // parsed definition — semantically identical.
        expect(first.definition).toEqual(definition);
        // Valid generated revisions never trigger these warnings.
        const codes = warningCodes(first.warnings);
        expect(codes).not.toContain('peg-empty');
        expect(codes).not.toContain('unusual-revision');
        expect(codes).not.toContain('duplicate-local-path');
        expect(codes).not.toContain('quoted-token');
        return true;
      },
      { runs: 300 }
    );
  });

  it('parses both layouts (modern and legacy) to identical semantics', () => {
    forAll(
      genRecord({
        definition: genDefinition,
        legacy: genPick([false, true]),
        attached: genPick([false, true]),
      }),
      ({ definition, legacy, attached }) => {
        // Out-of-domain shrink candidates (dropped keys) are not failures.
        if (!definition?.localPath || !definition?.url) return true;
        const parsed = parseSvnExternals(serializeDefinition(definition, legacy, attached));
        expect(parsed.definitions).toHaveLength(1);
        const parsedDefinition = parsed.definitions[0]?.definition;
        expect({
          localPath: parsedDefinition?.localPath,
          url: parsedDefinition?.url,
          operativeRevision: parsedDefinition?.operativeRevision,
          pegRevision: parsedDefinition?.pegRevision,
        }).toStrictEqual({
          localPath: definition.localPath,
          url: definition.url,
          operativeRevision: definition.operativeRevision,
          pegRevision: definition.pegRevision,
        });
        if (legacy) {
          expect(parsedDefinition?.legacy).toBe(true);
          expect(warningCodes(parsed.definitions[0]?.warnings ?? [])).toContain('legacy-form');
        } else {
          expect(parsedDefinition?.legacy).toBeUndefined();
        }
        return true;
      },
      { runs: 300 }
    );
  });

  it('multi-line values round-trip: parse → format → parse is semantically stable', () => {
    const genLine = genOneOf(
      genMap(genRecord({ definition: genDefinition, legacy: genPick([false, true]) }), ({ definition, legacy }) =>
        serializeDefinition(definition, legacy, false)
      ),
      genMap(genUnicodeString({ minLen: 1, maxLen: 10 }), (text) => `# ${text.split(/[\r\n]/)[0]}`),
      genConstant(''),
      // Hostile garbage: any single line that is not newline-separated.
      genMap(genUnicodeString({ minLen: 0, maxLen: 30 }), (raw) => raw.split(/[\r\n]/)[0])
    );
    forAll(
      genArray(genLine, { min: 0, max: 10 }),
      (rawLines) => {
        const value = rawLines.join('\n');
        const first = parseSvnExternals(value);
        const second = parseSvnExternals(formatSvnExternals(first.lines));

        expect(second.lines.map((line) => line.kind)).toEqual(first.lines.map((line) => line.kind));
        // ''.split('\n') yields one line, so an empty value has one (blank) line.
        expect(first.lines).toHaveLength(Math.max(1, rawLines.length));

        first.lines.forEach((line, index) => {
          const roundTripped = second.lines[index];
          if (line.kind === 'definition') {
            if (roundTripped?.kind !== 'definition') return true;
            // Definitions are rewritten in modern form: same fields, legacy
            // flag normalized away (and with it the one-shot `legacy-form`
            // warning), all other warnings re-derived identically.
            expect(roundTripped.definition.localPath).toBe(line.definition.localPath);
            expect(roundTripped.definition.url).toBe(line.definition.url);
            expect(roundTripped.definition.operativeRevision).toBe(line.definition.operativeRevision);
            expect(roundTripped.definition.pegRevision).toBe(line.definition.pegRevision);
            expect(roundTripped.definition.legacy).toBeUndefined();
            const withoutLegacyForm = warningCodes(line.warnings).filter((code) => code !== 'legacy-form');
            expect(warningCodes(roundTripped.warnings)).toEqual(withoutLegacyForm);
          } else {
            // Comments, blanks and invalid lines are preserved verbatim.
            expect(roundTripped).toStrictEqual(line);
          }
        });
        // The convenience view indexes definitions correctly.
        first.definitions.forEach((view) => {
          const indexed = first.lines[view.line - 1];
          expect(indexed?.kind).toBe('definition');
          if (indexed?.kind === 'definition') {
            expect(view.definition).toStrictEqual(indexed.definition);
          }
        });
        expect(first.definitions).toHaveLength(
          first.lines.filter((line) => line.kind === 'definition').length
        );
        return true;
      },
      { runs: 150 }
    );
  });

  it('duplicate local paths are flagged on every definition after the first', () => {
    forAll(
      genRecord({ definition: genDefinition, copy: genInt({ min: 1, max: 4 }) }),
      ({ definition, copy }) => {
        if (!definition?.localPath || !definition?.url || !Number.isInteger(copy) || copy < 1) {
          return true; // out-of-domain shrink candidate
        }
        const value = Array.from({ length: copy + 1 }, () =>
          formatExternalDefinition(definition)
        ).join('\n');
        const parsed = parseSvnExternals(value);
        expect(parsed.definitions).toHaveLength(copy + 1);
        parsed.definitions.forEach((view, index) => {
          const codes = warningCodes(view.warnings);
          if (index === 0) {
            expect(codes).not.toContain('duplicate-local-path');
          } else {
            expect(codes).toContain('duplicate-local-path');
          }
        });
        return true;
      },
      { runs: 60 }
    );
  });

  it('never throws on hostile multi-line unicode input and always classifies lines', () => {
    forAll(
      genArray(
        genMap(genUnicodeString({ minLen: 0, maxLen: 40 }), (raw) => raw.split(/[\r\n]/)[0]),
        { min: 0, max: 8 }
      ),
      (rawLines) => {
        const parsed = parseSvnExternals(rawLines.join('\n'));
        // ''.split('\n') yields one line, so an empty value has one (blank) line.
        expect(parsed.lines).toHaveLength(Math.max(1, rawLines.length));
        for (const line of parsed.lines) {
          if (!['definition', 'comment', 'blank', 'invalid'].includes(line.kind)) return false;
          if (line.kind === 'invalid') expect(typeof line.error).toBe('string');
          if (line.kind === 'comment') expect(line.raw.trim().startsWith('#')).toBe(true);
          if (line.kind === 'blank') expect(line.raw.trim()).toBe('');
        }
        return true;
      },
      { runs: 250 }
    );
  });

  it('validators agree with the generators: valid fields produce no issues', () => {
    forAll(
      genDefinition,
      (definition) => {
        if (!definition?.localPath || !definition?.url) return true; // out-of-domain shrink candidate
        expect(isValidExternalUrl(definition.url)).toBe(true);
        if (definition.operativeRevision) {
          expect(isValidExternalRevision(definition.operativeRevision)).toBe(true);
        }
        if (definition.pegRevision) {
          expect(isValidExternalRevision(definition.pegRevision)).toBe(true);
        }
        const issues = validateExternalFields({
          localPath: definition.localPath,
          url: definition.url,
          ...(definition.operativeRevision && { operativeRevision: definition.operativeRevision }),
          ...(definition.pegRevision && { pegRevision: definition.pegRevision }),
        });
        expect(issues.localPath).toEqual([]);
        expect(issues.url).toEqual([]);
        expect(issues.operativeRevision).toEqual([]);
        expect(issues.pegRevision).toEqual([]);
        return true;
      },
      { runs: 200 }
    );
  });
});
