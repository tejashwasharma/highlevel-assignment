import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { percentile, readDurations } = require('../../scripts/calc-percentiles');

describe('calc-percentiles: percentile()', () => {
  it('returns null for an empty array', () => {
    expect(percentile([], 95)).toBeNull();
  });

  it('returns the single value for a one-element array, at any percentile', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it('matches the textbook nearest-rank example: 100 sorted values, p95 is the 95th', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile(sorted, 99)).toBe(99);
    expect(percentile(sorted, 50)).toBe(50);
  });

  it('never indexes past the end of the array for p100 (or above)', () => {
    const sorted = [1, 2, 3];
    expect(percentile(sorted, 100)).toBe(3);
  });

  it('rounds up to the next rank rather than interpolating', () => {
    // 4 values, p95 -> ceil(0.95*4) = 4th (last) value, not an interpolated one.
    const sorted = [10, 20, 30, 40];
    expect(percentile(sorted, 95)).toBe(40);
  });
});

describe('calc-percentiles: readDurations()', () => {
  let logFile: string;

  beforeEach(() => {
    logFile = path.join(os.tmpdir(), `calc-percentiles-test-${Date.now()}.log`);
  });

  afterEach(() => {
    if (fs.existsSync(logFile)) {
      fs.unlinkSync(logFile);
    }
  });

  function writeLines(lines: unknown[]): void {
    fs.writeFileSync(logFile, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  }

  it('extracts durationMs only from lines whose message is "request"', () => {
    writeLines([
      { level: 'info', message: 'api listening on port 3000' },
      { level: 'info', message: 'request', method: 'GET', path: '/x', workspaceId: 'ws-1', durationMs: 1.5 },
      { level: 'info', message: 'request', method: 'GET', path: '/x', workspaceId: 'ws-1', durationMs: 2.5 },
      { level: 'warn', message: 'redis client error' },
    ]);

    const durations = readDurations(logFile, {});
    expect(durations).toEqual([1.5, 2.5]);
  });

  it('silently skips lines that are not valid JSON (e.g. non-logger stdout noise)', () => {
    fs.writeFileSync(
      logFile,
      [
        'not json at all',
        JSON.stringify({ message: 'request', durationMs: 3, path: '/x', workspaceId: 'ws-1' }),
        '',
      ].join('\n'),
    );

    const durations = readDurations(logFile, {});
    expect(durations).toEqual([3]);
  });

  it('filters by path, workspaceId, and method independently', () => {
    writeLines([
      { message: 'request', method: 'GET', path: '/a', workspaceId: 'ws-1', durationMs: 1 },
      { message: 'request', method: 'GET', path: '/b', workspaceId: 'ws-1', durationMs: 2 },
      { message: 'request', method: 'POST', path: '/a', workspaceId: 'ws-1', durationMs: 3 },
      { message: 'request', method: 'GET', path: '/a', workspaceId: 'ws-2', durationMs: 4 },
    ]);

    expect(readDurations(logFile, { path: '/a' })).toEqual([1, 3, 4]);
    expect(readDurations(logFile, { workspaceId: 'ws-2' })).toEqual([4]);
    expect(readDurations(logFile, { method: 'POST' })).toEqual([3]);
    expect(readDurations(logFile, { path: '/a', method: 'GET', workspaceId: 'ws-1' })).toEqual([1]);
  });
});
