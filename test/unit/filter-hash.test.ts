import { computeFilterHash } from '../../src/utils/filter-hash';

describe('computeFilterHash', () => {
  const workspaceId = 'ws-1';
  const targetStageId = 'stage-1';

  it('is deterministic: same inputs always produce the same hash', () => {
    const filter = { status: 'open' as const, owner: 'alice' };
    const a = computeFilterHash(workspaceId, filter, targetStageId);
    const b = computeFilterHash(workspaceId, filter, targetStageId);
    expect(a).toBe(b);
  });

  it('is independent of key order in the filter object', () => {
    const a = computeFilterHash(workspaceId, { status: 'open', owner: 'alice' }, targetStageId);
    const b = computeFilterHash(workspaceId, { owner: 'alice', status: 'open' }, targetStageId);
    expect(a).toBe(b);
  });

  it('changes when the filter content changes', () => {
    const a = computeFilterHash(workspaceId, { status: 'open' }, targetStageId);
    const b = computeFilterHash(workspaceId, { status: 'won' }, targetStageId);
    expect(a).not.toBe(b);
  });

  it('changes when the target stage changes, even with an identical filter', () => {
    const a = computeFilterHash(workspaceId, { status: 'open' }, 'stage-1');
    const b = computeFilterHash(workspaceId, { status: 'open' }, 'stage-2');
    expect(a).not.toBe(b);
  });

  it('changes when the workspace changes, even with an identical filter and target', () => {
    const a = computeFilterHash('ws-1', { status: 'open' }, targetStageId);
    const b = computeFilterHash('ws-2', { status: 'open' }, targetStageId);
    expect(a).not.toBe(b);
  });

  it('treats an empty filter the same as a filter with only undefined fields', () => {
    const a = computeFilterHash(workspaceId, {}, targetStageId);
    const b = computeFilterHash(workspaceId, { status: undefined }, targetStageId);
    expect(a).toBe(b);
  });
});
