// Your work: the signed-in user's queues, one section per desk they hold, then a map of every page.
// Each queue shows whose move it is: docs/product/requirements.md (R12) and docs/product/ux-direction.md.
// The desks come from apps/web/src/lib/work/desks.ts and the cards from apps/web/src/app/home/cards.ts.
import { quoteTotalsSchema, type SessionUser } from '@erp/types';
import { COLOR, InfoBanner, PageLede, PageShell } from '@erp/ui';

import { fetchParsed } from '../lib/fetch-parsed';
import { loadMe } from '../lib/load-me';
import { loadSalesReps } from '../lib/sales-reps';
import { desksFor, type Desk } from '../lib/work/desks';
import { loadWorkbook, type Workbook } from '../lib/work/load-workbook';
import {
  floorCards,
  productionManagerCards,
  quotedQuoteIds,
  salesCards,
  type DeskCards,
} from './home/cards';
import { FloorDesk } from './home/floor-desk';
import { ledeFor, refusedSentence } from './home/lede';
import { ProductionManagerDesk } from './home/production-manager-desk';
import { SalesDesk } from './home/sales-desk';

import { Sitemap } from './home/everywhere-else';
import { BillingDesk } from './home/billing-desk';
import { billingCards } from './home/billing-cards';
import { loadRepNames } from './home/billing-reads';

export const metadata = { title: 'Your work' };

// A Sales user who is an offerable rep sees their own customers' work. Anyone else sees everyone's.
async function ownRep(me: SessionUser): Promise<string | null> {
  if (!me.roles.includes('Sales')) return null;
  const reps = await loadSalesReps();
  return reps.some((rep) => rep.username === me.username) ? me.username : null;
}

async function loadAmounts(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const totals = await Promise.all(
    ids.map((id) =>
      fetchParsed(`/quoting/quotes/${encodeURIComponent(id)}/totals`, quoteTotalsSchema),
    ),
  );
  return new Map(ids.map((id, index) => [id, totals[index]?.extendedPrice ?? '0']));
}

function deskSection(desk: Desk, cards: ReadonlyMap<Desk['id'], DeskCards>) {
  const built = cards.get(desk.id);
  if (built === undefined) return null;
  switch (desk.id) {
    case 'sales':
      return <SalesDesk key={desk.id} desk={desk} cards={built} />;
    case 'production-manager':
      return <ProductionManagerDesk key={desk.id} desk={desk} cards={built} />;
    case 'floor':
      return <FloorDesk key={desk.id} desk={desk} cards={built} />;
    case 'billing':
      return <BillingDesk key={desk.id} desk={desk} cards={built} />;
    default:
      return null;
  }
}

async function buildCards(
  desks: readonly Desk[],
  wb: Workbook,
  now: Date,
  own: string | null,
): Promise<ReadonlyMap<Desk['id'], DeskCards>> {
  const built = new Map<Desk['id'], DeskCards>();
  for (const desk of desks) {
    switch (desk.id) {
      case 'sales':
        built.set(desk.id, salesCards(wb, now, own, await loadAmounts(quotedQuoteIds(wb, own))));
        break;
      case 'production-manager':
        built.set(desk.id, productionManagerCards(wb, now));
        break;
      case 'floor':
        built.set(desk.id, floorCards(wb, now));
        break;
      case 'billing':
        built.set(desk.id, billingCards(wb, now, await loadRepNames(wb)));
        break;
      default:
        break;
    }
  }
  return built;
}

export default async function HomePage() {
  const me = await loadMe();

  if (me === null) {
    return (
      <PageShell>
        <h1>ERP</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to continue.
        </p>
      </PageShell>
    );
  }

  const now = new Date();
  const desks = desksFor(me.roles);

  const [wb, own] =
    desks.length === 0 ? [null, null] : await Promise.all([loadWorkbook(me, now), ownRep(me)]);
  const cards: ReadonlyMap<Desk['id'], DeskCards> =
    wb === null ? new Map() : await buildCards(desks, wb, now, own);

  const quotes = new Set<string>();
  const orders = new Set<string>();
  const exceptions = new Set<string>();
  for (const built of cards.values()) {
    built.actNow.quotes.forEach((id) => quotes.add(id));
    built.actNow.orders.forEach((id) => orders.add(id));
    built.actNow.exceptions?.forEach((id) => exceptions.add(id));
  }
  const elsewhere = cards.get('sales')?.cards['waiting-on-another-desk'];

  const refused = wb === null ? null : refusedSentence(wb.refused);

  return (
    <PageShell>
      <h1>Your work</h1>
      <PageLede>
        {ledeFor({
          now,
          needYou: {
            quotes: quotes.size,
            orders: orders.size,
            exceptions: exceptions.size,
          },
          another:
            elsewhere === undefined
              ? null
              : {
                  count: elsewhere.count,
                  late: elsewhere.rows.flatMap((row) =>
                    row.late === true && row.age !== undefined ? [row.age] : [],
                  ),
                },
        })}
      </PageLede>

      {refused !== null && <InfoBanner>{refused}</InfoBanner>}

      {me.roles.length === 0 && (
        <InfoBanner>
          No roles have been assigned to your account yet, so you can read these areas but not
          change anything. Ask an Admin for the roles your job needs.
        </InfoBanner>
      )}

      {desks.map((desk) => deskSection(desk, cards))}

      <Sitemap roles={me.roles} />
    </PageShell>
  );
}
