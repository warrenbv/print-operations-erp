// Users: search the directory and grant or revoke ERP roles. Accounts are created in the directory,
// never here: docs/product/roles.md. The save goes through apps/web/src/app/admin/users/actions.ts.
import { ERP_ROLES, adminUserListResponseSchema, type AdminUserRow } from '@erp/types';
import {
  Box,
  Button,
  CheckboxLabel,
  COLOR,
  EmptyState,
  ErrorBanner,
  Field,
  FieldLabel,
  Hint,
  InfoBanner,
  Input,
  PageLede,
  PageShell,
  ResetList,
  SectionNote,
  SPACE,
  WarnBanner,
} from '@erp/ui';

import { SETTINGS_HREF } from '../../nav/nav-map';
import { fetchHealth, HealthLine } from '../../../lib/api-health';
import { fetchParsed } from '../../../lib/fetch-parsed';
import { loadMe } from '../../../lib/load-me';
import { setRolesAction } from './actions';
import { DIRECTORY_UNAVAILABLE_MESSAGE, usersView } from './directory-view';
import { gapMessage, gapSummary } from './notification-gaps';

export const metadata = { title: 'Users' };

interface PageProps {
  searchParams: Promise<{ q?: string; error?: string; notice?: string }>;
}

async function loadUsers(q: string): Promise<AdminUserRow[] | null> {
  const response = await fetchParsed(
    `/admin/users?q=${encodeURIComponent(q)}`,
    adminUserListResponseSchema,
    { serviceUnavailable: 'null' },
  );
  return response === null ? null : [...response.items];
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const { q = '', error, notice } = await searchParams;

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Users</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  // The API answers this list to Admin alone (ADMIN_SECTION_READ_ROLES in packages/types/src/roles.ts), and a 403
  // sends anyone else to /forbidden from `fetchParsed`, so every reader who reaches the rows may grant.
  const [users, health] = await Promise.all([loadUsers(q), fetchHealth()]);
  const view = usersView(users);

  const notificationGaps = view.kind === 'list' ? gapSummary(view.rows) : undefined;

  return (
    <PageShell>
      <p style={{ marginBottom: SPACE.md }}>
        <a href={SETTINGS_HREF} style={{ color: COLOR.accent }}>
          ← Settings
        </a>
      </p>
      <h1>Users</h1>

      <PageLede>
        Grant and revoke ERP roles for network users. Accounts are created in the directory, not
        here.
      </PageLede>

      <InfoBanner>{notice}</InfoBanner>
      <ErrorBanner message={error} />

      {notificationGaps !== undefined && <WarnBanner>{notificationGaps}</WarnBanner>}

      <SectionNote>
        <a href="/admin/roles" style={{ color: COLOR.accent }}>
          See who holds each role
        </a>
        .
      </SectionNote>

      <form
        method="get"
        style={{ margin: `${SPACE.xl} 0`, display: 'flex', gap: SPACE.md, alignItems: 'center' }}
      >
        <div style={{ flex: 1 }}>
          <Field>
            <FieldLabel>Search the directory</FieldLabel>
            <Input type="text" name="q" defaultValue={q} style={{ width: '100%' }} />
            <Hint>By name, username or email.</Hint>
          </Field>
        </div>
        <Button>Search</Button>
      </form>

      {view.kind === 'directory-unavailable' ? (
        <ErrorBanner message={DIRECTORY_UNAVAILABLE_MESSAGE} />
      ) : view.kind === 'no-matches' ? (
        <EmptyState>No users matched.</EmptyState>
      ) : (
        <ResetList>
          {view.rows.map((u) => (
            <li key={u.externalId}>
              <Box style={{ display: 'block', opacity: u.disabled === true ? 0.6 : 1 }}>
                <UserRow user={u} q={q} />
              </Box>
            </li>
          ))}
        </ResetList>
      )}

      <HealthLine health={health} />
    </PageShell>
  );
}

function UserIdentity({ user }: { user: AdminUserRow }) {
  const gap = gapMessage(user);

  return (
    <div>
      <strong>{user.displayName}</strong> — {user.username}
      {user.email !== undefined && <> · {user.email}</>}
      {gap !== undefined && (
        <div style={{ color: COLOR.warning, fontSize: '0.85rem', marginTop: SPACE.xs }}>
          ⚠ {gap}
        </div>
      )}
      {user.disabled === true && (
        <>
          {' '}
          · <em>disabled in the directory</em>
        </>
      )}
    </div>
  );
}

function UserRow({ user, q }: { user: AdminUserRow; q: string }) {
  return (
    <form action={setRolesAction} style={{ display: 'grid', gap: SPACE.md }}>
      <input type="hidden" name="externalId" value={user.externalId} />

      {q !== '' && <input type="hidden" name="q" value={q} />}
      <input type="hidden" name="username" value={user.username} />
      <input type="hidden" name="displayName" value={user.displayName} />
      {user.email !== undefined && <input type="hidden" name="email" value={user.email} />}

      <UserIdentity user={user} />

      <fieldset
        style={{ border: 'none', padding: 0, display: 'flex', gap: SPACE.lg, flexWrap: 'wrap' }}
      >
        <legend
          style={{ padding: 0, marginBottom: SPACE.xs, fontSize: '0.85rem', color: COLOR.muted }}
        >
          Roles
        </legend>
        {ERP_ROLES.map((role) => (
          <CheckboxLabel key={role}>
            <input
              type="checkbox"
              name="roles"
              value={role}
              defaultChecked={user.roles.includes(role)}
            />
            {role}
          </CheckboxLabel>
        ))}
      </fieldset>

      <div>
        <Button variant="primary">Save</Button>
      </div>
    </form>
  );
}
