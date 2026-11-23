// Settings page for the pricing constants every quote line is priced from: docs/product/requirements.md (R3).
// The margin floor is one of them. Changing it is the Billing Manager's remedy for a thin price: docs/product/requirements.md (R6).
// Other roles see the values read only. The form fields are defined in apps/web/src/app/quoting/config/fields.ts.
import {
  PRICING_CONFIG_WRITE_ROLES,
  pricingConfigHistoryResponseSchema,
  pricingConfigSchema,
} from '@erp/types';
import {
  Box,
  Button,
  COLOR,
  DataLine,
  ErrorBanner,
  Fold,
  FONT_SIZE,
  Hint,
  InfoBanner,
  Input,
  PageLede,
  PageShell,
  QueueCell,
  QueueGroupRow,
  QueueTable,
  SectionNote,
  SPACE,
} from '@erp/ui';
import { Fragment } from 'react';

import { SETTINGS_HREF } from '../../nav/nav-map';
import { formatTimestamp, isUnsetTimestamp } from '../../../lib/dates';
import { onlyDesk } from '../../../lib/helptext';
import { loadMe } from '../../../lib/load-me';
import { fetchParsed } from '../../../lib/fetch-parsed';

import { PERCENT_PATTERN } from '../../../lib/percent';
import { updatePricingConfigAction } from './actions';
import {
  CONFIG_FIELDS,
  changeLog,
  groupedFields,
  historySum,
  lastChangedBy,
  prefill,
} from './fields';

export const metadata = { title: 'Pricing constants' };

const COLUMNS = [{ label: 'Constant' }, { label: 'Value' }] as const;

interface PageProps {
  searchParams: Promise<{ error?: string; notice?: string }>;
}

export default async function PricingConfigPage({ searchParams }: PageProps) {
  const { error, notice } = await searchParams;

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Pricing constants</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const [config, history] = await Promise.all([
    fetchParsed('/quoting/config', pricingConfigSchema),
    fetchParsed('/quoting/config/history', pricingConfigHistoryResponseSchema),
  ]);
  // Hiding the form only spares other roles a refusal. The API enforces the role in
  // apps/api/src/quoting/catalog.controller.ts.
  const canWrite = PRICING_CONFIG_WRITE_ROLES.some((role) => me.roles.includes(role));
  const log = changeLog(config, history.items);
  const groups = groupedFields();

  const changed = isUnsetTimestamp(config.updatedAt)
    ? 'Not changed since setup.'
    : `Last changed by ${lastChangedBy(config.updatedBy)} at ${formatTimestamp(config.updatedAt)}.`;

  return (
    <PageShell>
      <p style={{ marginBottom: SPACE.md }}>
        <a href={SETTINGS_HREF} style={{ color: COLOR.accent }}>
          ← Settings
        </a>
      </p>
      <h1>Pricing constants</h1>
      <PageLede>
        The shared values every quote is priced from. Changing them reprices later quotes; quotes
        already sent keep their figures.
      </PageLede>
      <DataLine>{`${CONFIG_FIELDS.length} constants in ${groups.length} groups. ${changed}`}</DataLine>

      <ErrorBanner message={error} />
      {notice !== undefined && notice !== '' && <InfoBanner>{notice}</InfoBanner>}

      {!canWrite && (
        <>
          <SectionNote>{onlyDesk('the Billing Manager', 'changes these')}</SectionNote>
          <QueueTable columns={COLUMNS}>
            {groups.map(({ group, fields }) => (
              <Fragment key={group.id}>
                <QueueGroupRow span={COLUMNS.length}>{group.label}</QueueGroupRow>
                {fields.map((field) => (
                  <tr key={field.name}>
                    <QueueCell>{field.label}</QueueCell>
                    <QueueCell>{prefill(config, field)}</QueueCell>
                  </tr>
                ))}
              </Fragment>
            ))}
          </QueueTable>
        </>
      )}

      {canWrite && (
        <form action={updatePricingConfigAction}>
          <div style={{ overflowX: 'auto' }}>
            <QueueTable columns={COLUMNS}>
              {groups.map(({ group, fields }) => (
                <Fragment key={group.id}>
                  <QueueGroupRow span={COLUMNS.length}>{group.label}</QueueGroupRow>
                  {fields.map((field) => (
                    <tr key={field.name}>
                      <QueueCell>
                        <label htmlFor={`config-${field.name}`}>{field.label}</label>
                      </QueueCell>
                      <QueueCell>
                        <Input
                          id={`config-${field.name}`}
                          name={field.name}
                          defaultValue={prefill(config, field)}
                          required

                          {...(field.kind === 'percent'
                            ? { inputMode: 'decimal' as const, pattern: PERCENT_PATTERN }
                            : {})}
                          style={{ width: 200 }}
                        />
                        <Hint>{field.hint}</Hint>
                      </QueueCell>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </QueueTable>
          </div>
          <p style={{ marginTop: SPACE.xl }}>
            <Button variant="primary">Save constants</Button>
          </p>
        </form>
      )}

      <div style={{ marginTop: SPACE.xxl }}>
        <Fold summary="Change history" sum={historySum(log.length)}>
          <SectionNote>Every change made here, newest first.</SectionNote>
          {log.length === 0 ? (
            <p style={{ color: COLOR.muted }}>
              Nothing has changed since the constants were first loaded.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: SPACE.lg }}>
              {log.map((change) => (
                <Box key={`${change.at}-${change.actor}`}>
                  <p style={{ fontSize: FONT_SIZE.sm, color: COLOR.muted }}>
                    {formatTimestamp(change.at)} &mdash; {change.actor}
                  </p>
                  {change.movements.length === 0 ? (
                    <p style={{ color: COLOR.muted }}>No values moved.</p>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: SPACE.xl }}>
                      {change.movements.map((movement) => (
                        <li key={movement.label}>
                          {movement.label}: {movement.from} &rarr; {movement.to}
                        </li>
                      ))}
                    </ul>
                  )}
                </Box>
              ))}
            </div>
          )}
        </Fold>
      </div>
    </PageShell>
  );
}
