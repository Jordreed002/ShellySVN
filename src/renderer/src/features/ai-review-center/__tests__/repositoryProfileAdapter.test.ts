import { describe, expect, it } from 'vitest';
import {
  emptyRepositoryProfile,
  parseListInput,
  parseTerminologyInput,
} from '../repositoryProfileAdapter';

describe('repository profile editor helpers', () => {
  it('normalizes and deduplicates list input', () => {
    expect(parseListInput('tests/, docs/\ntests/')).toEqual(['tests/', 'docs/']);
  });

  it('accepts explicit terminology mappings and ignores incomplete lines', () => {
    expect(parseTerminologyInput('repo = repository\ninvalid\nlogin=sign in')).toEqual({
      repo: 'repository',
      login: 'sign in',
    });
  });

  it('defaults every fixed draft transformation to enabled', () => {
    expect(emptyRepositoryProfile().enabledDraftTransformations).toHaveLength(8);
    expect(emptyRepositoryProfile().subjectMaxLength).toBe(72);
  });
});
