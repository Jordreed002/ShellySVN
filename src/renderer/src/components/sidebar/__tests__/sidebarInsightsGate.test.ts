import { describe, expect, it } from 'vitest';

import { shouldLoadSidebarInsights } from '../sidebarInsightsGate';

describe('sidebar insights lazy gate', () => {
  it('does not load while collapsed, even after idle', () => {
    expect(shouldLoadSidebarInsights(true, true)).toBe(false);
  });

  it('waits for idle while expanded', () => {
    expect(shouldLoadSidebarInsights(false, false)).toBe(false);
    expect(shouldLoadSidebarInsights(false, true)).toBe(true);
  });
});
