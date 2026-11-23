// Roles: who holds each role, and where alerts reach nobody because a role has no holder or no
// holder has an email address. Roles are granted on apps/web/src/app/admin/users/page.tsx.
import { roleCatalogResponseSchema, type RoleCatalogResponse, type RoleHolders } from '@erp/types';
import {
  COLOR,
  InfoBanner,
  PageLede,
  PageShell,
  QueueCell,
  QueueTable,
  SectionNote,
  SPACE,
  StatusChip,
  WarnBanner,
} from '@erp/ui';

import { SETTINGS_HREF } from '../../nav/nav-map';
import { formatTimestamp } from '../../../lib/dates';
import { fetchParsed } from '../../../lib/fetch-parsed';
import { loadMe } from '../../../lib/load-me';
import { gapMessage } from '../users/notification-gaps';
import { roleGapNote, unfilledSummary } from './role-gaps';

export const metadata = { title: 'Roles' };

function failedAlertMessage(failed: RoleCatalogResponse['failedAlerts']): string | undefined {
  if (failed.count === 0) return undefined;
  const { count, windowDays, latest } = failed;
  const opening =
    count === 1
      ? `1 internal alert could not be sent in the last ${String(windowDays)} days`
      : `${String(count)} internal alerts could not be sent in the last ${String(windowDays)} days`;
  if (latest === undefined) {
    return `${opening}.`;
  }
  const why =
    latest.reason === 'no-holders'
      ? 'nobody held the role it was addressed to'
      : 'no holder of the role had an email address on record';
  return `${opening}. The most recent was about ${latest.subjectType} ${latest.subjectId} at ${formatTimestamp(latest.at)}, because ${why}.`;
}

async function loadCatalog(): Promise<RoleCatalogResponse> {
  return fetchParsed('/admin/roles', roleCatalogResponseSchema);
}

export default async function AdminRolesPage() {
  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Roles</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  // The API answers the catalogue to Admin alone, and a 403 sends anyone else to /forbidden from `fetchParsed`.
  const { items, failedAlerts } = await loadCatalog();
  const unfilled = unfilledSummary(items);
  const failed = failedAlertMessage(failedAlerts);

  return (
    <PageShell>
      <p style={{ marginBottom: SPACE.md }}>
        <a href={SETTINGS_HREF} style={{ color: COLOR.accent }}>
          ← Settings
        </a>
      </p>
      <h1>Roles</h1>

      <PageLede>
        Who holds each role. Roles are granted here, never taken from a directory group.
      </PageLede>

      {unfilled !== undefined && <WarnBanner>{unfilled}</WarnBanner>}
      {failed !== undefined && <WarnBanner>{failed}</WarnBanner>}
      {unfilled === undefined && failed === undefined && (
        <InfoBanner>
          Every role has a holder, and no internal alert has failed to send in the last{' '}
          {String(failedAlerts.windowDays)} days.
        </InfoBanner>
      )}

      <SectionNote>This counts alerts that had nobody to go to.</SectionNote>

      <p style={{ color: COLOR.muted }}>
        <a href="/admin/users" style={{ color: COLOR.accent }}>
          Grant or revoke a role
        </a>
      </p>

      <div style={{ marginTop: SPACE.lg, overflowX: 'auto' }}>
        <QueueTable columns={[{ label: 'Role' }, { label: 'Holders' }, { label: 'Who holds it' }]}>
          {items.map((entry) => (
            <RoleRow key={entry.role} entry={entry} />
          ))}
        </QueueTable>
      </div>
    </PageShell>
  );
}

function RoleRow({ entry }: { entry: RoleHolders }) {
  const gap = roleGapNote(entry);

  return (
    <tr>
      <QueueCell>
        <strong>{entry.role}</strong>
      </QueueCell>
      <QueueCell>
        <StatusChip tone={gap === undefined ? 'neutral' : 'warning'}>
          {entry.holders.length === 0
            ? 'no holders'
            : `${String(entry.holders.length)} ${entry.holders.length === 1 ? 'holder' : 'holders'}`}
        </StatusChip>
      </QueueCell>
      <QueueCell>
        {gap !== undefined && (
          <div style={{ color: COLOR.warning, fontSize: '0.85rem', marginBottom: SPACE.xs }}>
            ⚠ {gap}
          </div>
        )}

        {entry.holders.length === 0 ? (
          <span style={{ color: COLOR.muted }}>Nobody.</span>
        ) : (
          <HolderList entry={entry} />
        )}
      </QueueCell>
    </tr>
  );
}

function HolderList({ entry }: { entry: RoleHolders }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: SPACE.md }}>
      {entry.holders.map((holder) => {
        const unreachable = gapMessage({
          username: holder.username,
          ...(holder.email === undefined ? {} : { email: holder.email }),
          roles: [entry.role],
        });
        return (
          <li key={holder.externalId} style={{ fontSize: '0.9rem' }}>
            {holder.displayName} — {holder.username}
            {holder.email !== undefined && (
              <span style={{ color: COLOR.muted }}> · {holder.email}</span>
            )}
            {unreachable !== undefined && (
              <div style={{ color: COLOR.warning, fontSize: '0.85rem', marginTop: SPACE.xs }}>
                ⚠ {unreachable}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
