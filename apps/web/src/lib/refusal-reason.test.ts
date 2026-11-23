// Tests reading the `reason` token from a refused answer.
import { describe, expect, it } from 'vitest';

import { refusalReason } from './refusal-reason';

describe('refusalReason', () => {
  it('reads the token out of a typed refusal', async () => {
    const response = new Response(
      JSON.stringify({ reason: 'order-changed-since-build', message: 'the order changed' }),
      { status: 409 },
    );

    expect(await refusalReason(response)).toBe('order-changed-since-build');
  });

  it('is undefined when the body is JSON with no reason', async () => {
    const response = new Response(JSON.stringify({ statusCode: 409, message: 'Conflict' }), {
      status: 409,
    });

    expect(await refusalReason(response)).toBeUndefined();
  });

  it('is undefined when the body is not JSON', async () => {
    const response = new Response('<html>502 Bad Gateway</html>', { status: 502 });

    expect(await refusalReason(response)).toBeUndefined();
  });

  it('does not throw on an empty body', async () => {
    const response = new Response(null, { status: 502 });

    await expect(refusalReason(response)).resolves.toBeUndefined();
  });

  it('is undefined when the body is JSON but not an object', async () => {
    const response = new Response(JSON.stringify('nope'), { status: 500 });

    expect(await refusalReason(response)).toBeUndefined();
  });
});
