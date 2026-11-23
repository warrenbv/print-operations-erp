// Tests for the short display form of an id.
import { describe, expect, it } from 'vitest';

import { shortId } from '../src/identifier';

function v7(timestampPrefix: string, tail: string): string {
  return `${timestampPrefix}-7000-8000-${tail.padStart(12, '0')}`;
}

describe('shortId', () => {
  it('takes the last segment of a UUID', () => {
    expect(shortId('01b07c4e-0f3a-7000-8000-00000000abcd')).toBe('0000abcd');
  });

  it('is stable: the same id always renders the same way', () => {
    const id = '01a05e68-b4e6-7497-b81d-7dda9f7e82f6';
    expect(shortId(id)).toBe(shortId(id));
    expect(shortId(id)).toBe('9f7e82f6');
  });

  it('is eight characters wide, with no hyphen', () => {
    for (const id of [
      '01b07c4e-0f3a-7000-8000-000000000001',
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    ]) {
      expect(shortId(id)).toHaveLength(8);
      expect(shortId(id)).not.toContain('-');
    }
  });

  it('separates records minted in the same millisecond', () => {
    const sameMillisecond = Array.from({ length: 1000 }, (_, i) =>
      v7('01b3d29e-4a7d', (i + 1).toString(16)),
    );

    expect(new Set(sameMillisecond.map(shortId)).size).toBe(1000);

    expect(new Set(sameMillisecond.map((id) => id.slice(0, 8))).size).toBe(1);
  });

  it('ignores the clock entirely', () => {
    const tail = '7dda9f7e82f6';
    expect(shortId(v7('01b07c4e-0f3a', tail))).toBe(shortId(v7('01b3d29e-9999', tail)));
  });

  it('does not distinguish two ids that share a last segment', () => {
    const a = '01b07c4e-0f3a-7000-8000-000000000001';
    const b = '01b3d29e-9999-7000-8000-000000000001';
    expect(shortId(a)).toBe(shortId(b));
  });

  it('never contains a hyphen, even on an id that is not a whole UUID', () => {
    expect(shortId('01b5e813-d4a6-7f3b')).toBe('7f3b');
    expect(shortId('01b5e813-d4a6-7f3b')).not.toContain('-');

    expect(shortId('3f8a1c5e9b07d264')).toBe('9b07d264');
  });

  it('is the tail of the id it names, not a prefix', () => {
    const id = '01a05e68-b4e6-7497-b81d-7dda9f7e82f6';
    expect(id.startsWith(shortId(id))).toBe(false);
    expect(id.endsWith(shortId(id))).toBe(true);
  });
});
