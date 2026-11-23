// The API health line: the address the web server uses and the API's version, or why it did not answer.
// Shown on apps/web/src/app/admin/users/page.tsx. The payload is packages/types/src/health.ts.
import { healthPayloadSchema, type HealthPayload } from '@erp/types';
import { COLOR, FONT_SIZE, SPACE } from '@erp/ui';

import { API_SERVER_URL } from './api-fetch';

export async function fetchHealth(): Promise<HealthPayload | { error: string }> {
  try {
    const res = await fetch(`${API_SERVER_URL}/health`, { cache: 'no-store' });
    if (!res.ok) return { error: `API responded ${res.status}` };

    return healthPayloadSchema.parse(await res.json());
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function HealthLine({ health }: { health: HealthPayload | { error: string } }) {
  const ok = !('error' in health);
  return (
    <p
      style={{
        marginTop: SPACE.xxxl,
        paddingTop: SPACE.lg,
        borderTop: `1px solid ${COLOR.border}`,
        fontSize: FONT_SIZE.xs,
        color: ok ? COLOR.muted : COLOR.danger,
      }}
    >
      API {API_SERVER_URL} — {ok ? `ok, version ${health.version}` : health.error}
    </p>
  );
}
