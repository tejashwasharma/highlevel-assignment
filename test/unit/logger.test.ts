import { logger } from '../../src/utils/logger';

describe('logger', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('info() writes a single, valid JSON line to console.log', () => {
    logger.info('hello');

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0][0];
    expect(() => JSON.parse(line)).not.toThrow();
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('hello');
    expect(parsed.timestamp).toEqual(expect.any(String));
  });

  it('spreads meta fields directly into the JSON object, not nested', () => {
    logger.info('applied chunk', { jobId: 'job-1', doneCount: 5 });

    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.jobId).toBe('job-1');
    expect(parsed.doneCount).toBe(5);
  });

  it('warn() and error() route to console.warn/console.error respectively, both as JSON', () => {
    logger.warn('careful');
    logger.error('broken');

    expect(JSON.parse(warnSpy.mock.calls[0][0])).toMatchObject({ level: 'warn', message: 'careful' });
    expect(JSON.parse(errorSpy.mock.calls[0][0])).toMatchObject({ level: 'error', message: 'broken' });
  });

  it('omitting meta still produces valid JSON with no extra fields beyond level/message/timestamp', () => {
    logger.info('no meta here');

    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(Object.keys(parsed).sort()).toEqual(['level', 'message', 'timestamp']);
  });
});
