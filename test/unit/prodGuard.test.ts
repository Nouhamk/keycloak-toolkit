import { describe, expect, it } from 'vitest';
import { ProdGuard } from '../../src/connections/ProdGuard';
import type { Connection } from '../../src/connections/types';

const c = (environment: Connection['environment']): Connection => ({
  id: environment,
  name: environment,
  baseUrl: 'http://x',
  authRealm: 'master',
  authMethod: 'password',
  principal: 'admin',
  environment,
});

describe('ProdGuard', () => {
  it('locks prod by default and only prod', () => {
    const g = new ProdGuard();
    expect(g.isLocked(c('prod'))).toBe(true);
    expect(g.isLocked(c('staging'))).toBe(false);
    expect(() => g.assertWritable(c('prod'))).toThrow(/read-only/);
  });
  it('unlocks and relocks', () => {
    const g = new ProdGuard();
    g.unlock('prod');
    expect(() => g.assertWritable(c('prod'))).not.toThrow();
    g.lock('prod');
    expect(g.isLocked(c('prod'))).toBe(true);
  });
});
