// Settings page for the pricing tiers that choose a line's margin by pallet count: docs/product/requirements.md (R3).
// The Billing Manager edits them (docs/product/roles.md). Others see them read only.
import {
  PRICING_CONFIG_WRITE_ROLES,
  pricingTierHistoryResponseSchema,
  pricingTierListResponseSchema,
} from '@erp/types';
import {
  Box,
  Button,
  COLOR,
  DataLine,
  ErrorBanner,
  Field,
  FieldLabel,
  Fold,
  FONT_SIZE,
  Hint,
  InfoBanner,
  Input,
  PageLede,
  PageShell,
  QueueCell,
  QueueTable,
  SectionNote,
  SPACE,
} from '@erp/ui';

import { SETTINGS_HREF } from '../../nav/nav-map';
import { formatTimestamp } from '../../../lib/dates';
import { onlyDesk } from '../../../lib/helptext';
import { loadMe } from '../../../lib/load-me';
import { fetchParsed } from '../../../lib/fetch-parsed';

import { PERCENT_PATTERN } from '../../../lib/percent';
import { historySum } from '../config/fields';
import { createPricingTierAction, updatePricingTierAction } from './actions';
import {
  TIER_FIELDS,
  asPercent,
  lastChangedBy,
  multiplierOf,
  tierChangeLog,
  valueOf,
} from './fields';

export const metadata = { title: 'Pricing tiers' };

interface PageProps {
  searchParams: Promise<{ error?: string; notice?: string }>;
}

function formId(code: string): string {
  return `tier-${code}`;
}

export default async function PricingTiersPage({ searchParams }: PageProps) {
  const { error, notice } = await searchParams;

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Pricing tiers</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const [tiers, history] = await Promise.all([
    fetchParsed('/quoting/tiers', pricingTierListResponseSchema),
    fetchParsed('/quoting/tiers/history', pricingTierHistoryResponseSchema),
  ]);
  // Hiding the form only spares other roles a refusal. The API enforces the role in
  // apps/api/src/quoting/catalog.controller.ts.
  const canWrite = PRICING_CONFIG_WRITE_ROLES.some((role) => me.roles.includes(role));
  const log = tierChangeLog(tiers.items, history.items);
  const count = tiers.items.length;

  const columns = [
    { label: 'Tier' },
    { label: 'Code' },
    { label: 'From pallets', num: true },
    { label: 'Margin %', num: true },
    { label: '× Cost', num: true },
    { label: 'Last changed' },
    ...(canWrite ? [{ label: '' }] : []),
  ];

  return (
    <PageShell>
      <p style={{ marginBottom: SPACE.md }}>
        <a href={SETTINGS_HREF} style={{ color: COLOR.accent }}>
          ← Settings
        </a>
      </p>
      <h1>Pricing tiers</h1>
      <PageLede>
        The volume bands a quote line is priced through. A line takes the band its pallet count
        falls into unless Sales picks one.
      </PageLede>
      <DataLine>{`${count} tier${count === 1 ? '' : 's'} in the table.`}</DataLine>

      <ErrorBanner message={error} />
      {notice !== undefined && notice !== '' && <InfoBanner>{notice}</InfoBanner>}

      {!canWrite && (
        <SectionNote>{onlyDesk('the Billing Manager', 'changes the tiers')}</SectionNote>
      )}

      <SectionNote>
        One band must start at 0 pallets, or a small quote has no tier. The published list tier is
        not editable here.
      </SectionNote>

      {canWrite &&
        tiers.items.map((tier) => (
          <form key={tier.code} id={formId(tier.code)} action={updatePricingTierAction}>
            <input type="hidden" name="code" value={tier.code} />
          </form>
        ))}

      <div style={{ overflowX: 'auto' }}>
        <QueueTable columns={columns}>
          {tiers.items.map((tier) => (
            <tr key={tier.code}>
              <QueueCell>
                {canWrite ? (
                  <Input
                    form={formId(tier.code)}
                    name="name"
                    aria-label={`Name for ${tier.code}`}
                    defaultValue={valueOf(tier, 'name')}
                    required
                    style={{ width: 180 }}
                  />
                ) : (
                  tier.name
                )}
                {tier.isListTier && (
                  <span style={{ color: COLOR.muted, fontSize: FONT_SIZE.sm }}>
                    {' '}
                    published list tier
                  </span>
                )}
              </QueueCell>

              <QueueCell>
                <code>{tier.code}</code>
              </QueueCell>
              <QueueCell num>
                {canWrite ? (
                  <Input
                    form={formId(tier.code)}
                    name="minPallets"
                    aria-label={`From pallets for ${tier.code}`}
                    inputMode="numeric"
                    defaultValue={valueOf(tier, 'minPallets')}
                    required
                    style={{ width: 90 }}
                  />
                ) : (
                  tier.minPallets
                )}
              </QueueCell>
              <QueueCell num>
                {canWrite ? (
                  <Input
                    form={formId(tier.code)}
                    name="marginPct"
                    aria-label={`Margin % for ${tier.code}`}
                    inputMode="decimal"
                    pattern={PERCENT_PATTERN}
                    defaultValue={valueOf(tier, 'marginPct')}
                    required
                    style={{ width: 120 }}
                  />
                ) : (
                  <span>{asPercent(tier.marginPct)}</span>
                )}
              </QueueCell>

              <QueueCell num>{multiplierOf(tier.marginPct)}</QueueCell>
              <QueueCell>
                <span style={{ fontSize: FONT_SIZE.sm, color: COLOR.muted }}>
                  {lastChangedBy(tier.updatedBy)}
                </span>
              </QueueCell>
              {canWrite && (
                <QueueCell>
                  <Button form={formId(tier.code)} ariaLabel={`Save ${tier.code}`}>
                    Save
                  </Button>
                </QueueCell>
              )}
            </tr>
          ))}
        </QueueTable>
      </div>

      {canWrite && (
        <div style={{ marginTop: SPACE.xxl }}>
          <Fold summary="Add a tier">
            <form action={createPricingTierAction}>
              <div style={{ display: 'grid', gap: SPACE.lg }}>
                <Field>
                  <FieldLabel>Code</FieldLabel>
                  <Input name="code" required style={{ width: 200 }} />

                  <Hint>
                    Lower case letters, digits and underscores. It cannot be renamed later.
                  </Hint>
                </Field>
                {TIER_FIELDS.map((field) => (
                  <Field key={field.name}>
                    <FieldLabel>{field.label}</FieldLabel>
                    <Input
                      name={field.name}
                      required
                      {...(field.kind === 'percent'
                        ? { inputMode: 'decimal' as const, pattern: PERCENT_PATTERN }
                        : {})}
                      style={{ width: 200 }}
                    />
                    <Hint>{field.hint}</Hint>
                  </Field>
                ))}
              </div>
              <p style={{ marginTop: SPACE.xl }}>
                <Button variant="primary">Add tier</Button>
              </p>
            </form>
          </Fold>
        </div>
      )}

      <div style={{ marginTop: SPACE.xxl }}>
        <Fold summary="Change history" sum={historySum(log.length)}>
          <SectionNote>Every tier change made here, newest first.</SectionNote>
          {log.length === 0 ? (
            <p style={{ color: COLOR.muted }}>
              Nothing has changed since the tiers were first loaded.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: SPACE.lg }}>
              {log.map((change) => (
                <Box key={`${change.at}-${change.tierCode}`}>
                  <p style={{ fontSize: FONT_SIZE.sm, color: COLOR.muted }}>
                    {formatTimestamp(change.at)} &mdash; {change.tierName} &mdash; {change.actor}
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
