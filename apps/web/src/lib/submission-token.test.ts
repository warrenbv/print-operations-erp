// Tests that a token runs its form's work once, replays the outcome, and expires.
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SUBMISSION_TOKEN_FIELD,
  mintSubmissionToken,
  resetSubmissionTokens,
  withSubmissionToken,
} from './submission-token';

afterEach(() => {
  resetSubmissionTokens();
  vi.useRealTimers();
});

function deferred(): { promise: Promise<string>; resolve: (v: string) => void } {
  let resolve!: (v: string) => void;
  const promise = new Promise<string>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('withSubmissionToken', () => {
  it('runs the body once for two callers holding the same token', async () => {
    const gate = deferred();
    let runs = 0;
    const body = async (): Promise<string> => {
      runs += 1;
      return gate.promise;
    };

    const first = withSubmissionToken('tok', body);
    const second = withSubmissionToken('tok', body);
    gate.resolve('created');

    expect(await first).toBe('created');
    expect(await second).toBe('created');
    expect(runs).toBe(1);
  });

  it('replays a thrown outcome, so the second press sees the first answer', async () => {
    const redirectish = new Error('NEXT_REDIRECT;/crm/customers/new-id');
    let runs = 0;
    const body = async (): Promise<never> => {
      runs += 1;
      throw redirectish;
    };

    await expect(withSubmissionToken('tok', body)).rejects.toBe(redirectish);
    await expect(withSubmissionToken('tok', body)).rejects.toBe(redirectish);
    expect(runs).toBe(1);
  });

  it('runs again for a different token', async () => {
    let runs = 0;
    const body = async (): Promise<number> => {
      runs += 1;
      return runs;
    };

    expect(await withSubmissionToken('one', body)).toBe(1);
    expect(await withSubmissionToken('two', body)).toBe(2);
  });

  it('runs normally when the form carries no token', async () => {
    let runs = 0;
    const body = async (): Promise<number> => {
      runs += 1;
      return runs;
    };

    await withSubmissionToken(undefined, body);
    await withSubmissionToken(undefined, body);
    await withSubmissionToken('', body);
    expect(runs).toBe(3);
  });

  it('forgets a token once its window has passed', async () => {
    vi.useFakeTimers();
    let runs = 0;
    const body = async (): Promise<number> => {
      runs += 1;
      return runs;
    };

    expect(await withSubmissionToken('tok', body)).toBe(1);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await withSubmissionToken('tok', body)).toBe(2);
  });

  it('starts the window when the body settles, not when it began', async () => {
    vi.useFakeTimers();
    const gate = deferred();
    let runs = 0;
    const body = async (): Promise<string> => {
      runs += 1;
      return gate.promise;
    };

    const first = withSubmissionToken('tok', body);
    await vi.advanceTimersByTimeAsync(59_000);
    gate.resolve('created');
    await first;

    await vi.advanceTimersByTimeAsync(30_000);
    expect(await withSubmissionToken('tok', body)).toBe('created');
    expect(runs).toBe(1);
  });

  it('keeps the map bounded, evicting the oldest first', async () => {
    vi.useFakeTimers();
    let runs = 0;
    const body = async (): Promise<number> => {
      runs += 1;
      return runs;
    };

    await withSubmissionToken('oldest', body);
    for (let i = 0; i < 1_000; i += 1) {
      await withSubmissionToken(`filler-${String(i)}`, body);
    }

    const before = runs;
    await withSubmissionToken('oldest', body);
    expect(runs).toBe(before + 1);
  });
});

describe('mintSubmissionToken', () => {
  it('is different on every render, which is what makes it per-render', () => {
    expect(mintSubmissionToken()).not.toBe(mintSubmissionToken());
  });
});

describe('SUBMISSION_TOKEN_FIELD', () => {
  it('is one spelling, so a form and the guard cannot disagree', () => {
    expect(SUBMISSION_TOKEN_FIELD).toBe('submissionToken');
  });
});
