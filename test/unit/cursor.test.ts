import { encodeCursor, decodeCursor } from '../../src/utils/cursor';

describe('cursor encode/decode', () => {
  it('round-trips a value through encode then decode', () => {
    const payload = JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z', id: 'abc-123' });
    expect(decodeCursor(encodeCursor(payload))).toBe(payload);
  });

  it('produces a URL-safe string (no +, /, or = padding)', () => {
    const encoded = encodeCursor('some payload with enough entropy to hit padding/+//');
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('is not the identity function (actually encodes, not a passthrough)', () => {
    const payload = 'plain text';
    expect(encodeCursor(payload)).not.toBe(payload);
  });
});
