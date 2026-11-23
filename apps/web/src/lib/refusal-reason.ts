// Reads the `reason` token from a refused API answer, for an action that branches on the reason.
// To show a refusal to a person, use apps/web/src/lib/api-error.ts instead.
export async function refusalReason(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (body === null || typeof body !== 'object') {
      return undefined;
    }
    const reason = (body as Record<string, unknown>)['reason'];
    return typeof reason === 'string' ? reason : undefined;
  } catch {
    return undefined;
  }
}
