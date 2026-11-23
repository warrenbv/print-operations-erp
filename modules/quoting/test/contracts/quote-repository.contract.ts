// The contract for `QuoteRepository` in modules/quoting/src/ports.ts. One set of assertions, run
// against the in-memory and the Drizzle adapter by
// modules/quoting/test/repository-contracts.test.ts. It pins down lists and filters, quote numbers,
// line replacement, sends, revisions, override decisions and transitions. Every write bumps
// `lockVersion`, a line edit included, and a stale guarded write changes nothing:
// docs/decisions/006-optimistic-concurrency.md. A failure means one adapter breaks a promise the
// other keeps: docs/process/verifying-agent-written-code.md.
import { newId } from '@erp/db';
import {
  freightKnowledge,
  quoteListItemSchema,
  quoteWithLinesSchema,
  type QuoteLine,
} from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  LineEditRevocationMissingError,
  QuoteNotEditableError,
  QuoteNotRevisableError,
  QuoteVersionConflictError,
  StaleAggregateError,
} from '../../src/ports';
import type { NewQuoteLine, NewQuoteSend, QuoteRepository } from '../../src/ports';

export function quoteRepositoryContract(
  makeRepo: () => Promise<QuoteRepository>,
  gradeId: string = newId(),
): void {
  const NOW = new Date('2026-08-07T09:00:00.000Z');
  const LATER = new Date('2026-08-07T10:00:00.000Z');

  const newQuote = (over: Partial<Parameters<QuoteRepository['create']>[0]> = {}) => {
    const id = over.id ?? newId();
    return {
      id,
      customerId: newId(),
      status: 'draft' as const,

      rootQuoteId: id,
      versionNumber: 1,
      createdAt: NOW,
      updatedAt: NOW,
      ...over,
    };
  };

  const newLine = (over: Partial<NewQuoteLine> = {}): NewQuoteLine => ({
    id: newId(),
    lineNumber: 1,
    gradeId,

    revenueCategory: 'print',
    printed: false,
    taxStatus: 'id_tax',
    taxJurisdiction: 'ID',
    footageVariant: 'short',
    rollWidthIn: 24,
    quantityRolls: 1150,
    overwrap: false,

    pricingBasis: 'per_roll',
    cost: {
      rollWeightLb: '18.7250',

      paperCostPerLb: '0.46266422',
      paperCostPerRoll: '8.6634',
      hardwareCostPerRoll: '1.8865',
      addOnCostPerRoll: '0.0000',
      totalCostPerRoll: '10.5499',
      rollsPerPallet: 50,
      feetPerRoll: '1000.0000',
    },
    tier: {
      id: newId(),
      code: 'volume_4',
      name: 'Volume 4',
      marginPct: '0.210000',
      source: 'auto',
    },
    pallets: 23,
    priceSource: 'tier',
    freight: { mode: 'pickup' },
    freightResult: {
      mode: 'pickup',
      cost: '0.0000',
      margin: '0.0000',
      invoiceTotal: '0.0000',
      pending: false,
    },
    basePricePerRoll: '13.3543',
    pricePerRoll: '13.3543',
    deliveredPricePerRoll: '13.3543',
    marginPct: '0.210000',
    floor: { status: 'ok' },
    extendedPrice: '15357.4450',
    extendedCost: '12132.3850',
    extendedMargin: '3225.0600',
    estimatedWeightLb: '21533.7500',
    pricePerLb: '0.7132',
    effectivePricePerLb: '0.7132',
    ...over,
  });

  describe('create', () => {
    it('returns the quote it stored', async () => {
      const repo = await makeRepo();
      const input = newQuote({ salesRep: 'jsmith', notes: 'rush job' });
      const created = await repo.create(input);

      expect(created).toMatchObject({
        id: input.id,
        customerId: input.customerId,
        status: 'draft',
        salesRep: 'jsmith',
        notes: 'rush job',
      });
    });

    it('omits absent optional fields rather than surfacing null', async () => {
      const repo = await makeRepo();
      const created = await repo.create(newQuote());

      expect(created).not.toHaveProperty('salesRep');
      expect(created).not.toHaveProperty('notes');
    });

    it('starts with no lines', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      expect((await repo.findWithLines(input.id))?.lines).toEqual([]);
    });

    it('allows many quotes for one customer', async () => {
      const repo = await makeRepo();
      const customerId = newId();
      await repo.create(newQuote({ customerId }));
      await repo.create(newQuote({ customerId }));

      expect(await repo.list({ customerIds: [customerId] })).toHaveLength(2);
    });
  });

  describe('findById / findWithLines', () => {
    it('returns null for unknown ids rather than throwing', async () => {
      const repo = await makeRepo();
      expect(await repo.findById(newId())).toBeNull();
      expect(await repo.findWithLines(newId())).toBeNull();
    });
  });

  describe('list', () => {
    it('filters by status', async () => {
      const repo = await makeRepo();
      const a = newQuote();
      await repo.create(a);
      await repo.create(newQuote());
      await repo.transition(a.id, 'closed_lost', NOW);

      expect(await repo.list({ status: 'closed_lost' })).toHaveLength(1);
      expect(await repo.list({ status: 'draft' })).toHaveLength(1);
    });

    it('returns newest first', async () => {
      const repo = await makeRepo();
      const older = newQuote({ createdAt: NOW, updatedAt: NOW });
      const newer = newQuote({ createdAt: LATER, updatedAt: LATER });
      await repo.create(older);
      await repo.create(newer);

      expect((await repo.list({})).map((q) => q.id)).toEqual([newer.id, older.id]);
    });

    it('is empty, not null, when nothing matches', async () => {
      expect(await (await makeRepo()).list({ status: 'quoted' })).toEqual([]);
    });

    describe('sort, limit and countAndOldest', () => {
      const seed = async (repo: QuoteRepository) => {
        const customerId = newId();
        const a = newQuote({
          customerId,
          createdAt: new Date('2026-08-01T10:00:00.000Z'),
          updatedAt: new Date('2026-08-05T10:00:00.000Z'),
        });
        const b = newQuote({
          customerId,
          createdAt: new Date('2026-08-02T10:00:00.000Z'),
          updatedAt: new Date('2026-08-04T10:00:00.000Z'),
        });
        const c = newQuote({
          customerId,
          status: 'closed_lost',
          createdAt: new Date('2026-08-03T10:00:00.000Z'),
          updatedAt: new Date('2026-08-03T10:00:00.000Z'),
        });
        for (const quote of [a, b, c]) {
          await repo.create(quote);
        }
        return { customerId, a, b, c };
      };

      it('keeps newest-created-first when no sort is asked for', async () => {
        const repo = await makeRepo();
        const { customerId, a, b, c } = await seed(repo);
        expect((await repo.list({ customerIds: [customerId] })).map((q) => q.id)).toEqual([
          c.id,
          b.id,
          a.id,
        ]);
      });

      it('sorts by updatedAt both ways and cuts the limit after the sort', async () => {
        const repo = await makeRepo();
        const { customerId, a, b, c } = await seed(repo);
        const customerIds = [customerId];

        expect((await repo.list({ customerIds, sort: 'oldest' })).map((q) => q.id)).toEqual([
          c.id,
          b.id,
          a.id,
        ]);
        expect((await repo.list({ customerIds, sort: 'newest' })).map((q) => q.id)).toEqual([
          a.id,
          b.id,
          c.id,
        ]);
        expect(
          (await repo.list({ customerIds, sort: 'oldest', limit: 2 })).map((q) => q.id),
        ).toEqual([c.id, b.id]);
        expect(
          (await repo.list({ customerIds, sort: 'newest', limit: 1 })).map((q) => q.id),
        ).toEqual([a.id]);
      });

      it('counts what the list returns under the same filters, with the oldest by updatedAt', async () => {
        const repo = await makeRepo();
        const { customerId, b, c } = await seed(repo);
        const customerIds = [customerId];

        for (const filters of [
          { customerIds },
          { customerIds, status: 'draft' as const },
          { customerIds, status: 'quoted' as const },
          { customerIds, leadTime: 'missing' as const },
        ]) {
          const listed = await repo.list(filters);
          const counted = await repo.countAndOldest(filters);
          expect(counted.count).toBe(listed.length);
          const oldest = [...listed].sort((x, y) => x.updatedAt.localeCompare(y.updatedAt))[0];
          if (oldest === undefined) {
            expect(counted.oldest).toBeNull();
          } else {
            const { lineCount, belowFloorCount, manualCount, manualPricePerRoll, ...header } =
              oldest;
            void [lineCount, belowFloorCount, manualCount, manualPricePerRoll];
            expect(counted.oldest).toEqual(header);
          }
        }

        expect((await repo.countAndOldest({ customerIds })).oldest?.id).toBe(c.id);
        expect((await repo.countAndOldest({ customerIds, status: 'draft' })).oldest?.id).toBe(b.id);
        expect(await repo.countAndOldest({ customerIds: [] })).toEqual({ count: 0, oldest: null });
        expect(await repo.countAndOldest({ customerIds: [newId()] })).toEqual({
          count: 0,
          oldest: null,
        });
      });
    });

    it('carries no lines, so a listing does not drag every line along', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine()], NOW);

      const [listed] = await repo.list({});
      expect(listed).not.toHaveProperty('lines');
    });

    it('filters by sales rep', async () => {
      const repo = await makeRepo();
      const jane = newQuote({ salesRep: 'jsmith' });
      await repo.create(jane);
      await repo.create(newQuote({ salesRep: 'rlee' }));
      await repo.create(newQuote());

      expect((await repo.list({ salesRep: 'jsmith' })).map((q) => q.id)).toEqual([jane.id]);
    });

    it('matches the rep exactly, free text included', async () => {
      const repo = await makeRepo();
      const typed = newQuote({ salesRep: 'Smith, Jane' });
      await repo.create(typed);
      await repo.create(newQuote({ salesRep: 'jsmith' }));

      expect((await repo.list({ salesRep: 'Smith, Jane' })).map((q) => q.id)).toEqual([typed.id]);
      expect(await repo.list({ salesRep: 'Smith' })).toEqual([]);
    });

    it('leaves a quote with no rep out of every rep filter', async () => {
      const repo = await makeRepo();
      await repo.create(newQuote());

      expect(await repo.list({ salesRep: 'jsmith' })).toEqual([]);
    });

    it('composes the rep with the status and the customer', async () => {
      const repo = await makeRepo();
      const customerId = newId();
      const wanted = newQuote({ customerId, salesRep: 'jsmith' });
      await repo.create(wanted);
      await repo.create(newQuote({ customerId, salesRep: 'rlee' }));
      await repo.create(newQuote({ salesRep: 'jsmith' }));

      expect(
        (await repo.list({ customerIds: [customerId], salesRep: 'jsmith' })).map((q) => q.id),
      ).toEqual([wanted.id]);
      expect(
        await repo.list({ customerIds: [customerId], salesRep: 'jsmith', status: 'quoted' }),
      ).toEqual([]);
    });

    it('lists only the quotes with no lead time, counting zero days as entered', async () => {
      const repo = await makeRepo();
      const customerId = newId();
      const waiting = await repo.create(newQuote({ customerId }));
      const entered = await repo.create(newQuote({ customerId }));
      const zero = await repo.create(newQuote({ customerId }));
      await repo.setLeadTime(entered.id, 10, 'pm', LATER, entered.lockVersion);
      await repo.setLeadTime(zero.id, 0, 'pm', LATER, zero.lockVersion);

      const missing = await repo.list({ customerIds: [customerId], leadTime: 'missing' });
      expect(missing.map((q) => q.id)).toEqual([waiting.id]);

      expect(await repo.list({ customerIds: [customerId] })).toHaveLength(3);
    });

    it('stores who entered the lead time and when, and reads them back', async () => {
      const repo = await makeRepo();
      const quote = await repo.create(newQuote({ customerId: newId() }));
      expect(quote.leadTimeSetBy).toBeUndefined();
      expect(quote.leadTimeSetAt).toBeUndefined();

      const saved = await repo.setLeadTime(
        quote.id,
        10,
        'dev-production',
        LATER,
        quote.lockVersion,
      );

      expect(saved?.leadTimeSetBy).toBe('dev-production');
      expect(saved?.leadTimeSetAt).toBe(LATER.toISOString());
      const read = await repo.findById(quote.id);
      expect(read?.leadTimeSetBy).toBe('dev-production');
      expect(read?.leadTimeSetAt).toBe(LATER.toISOString());
    });

    it('composes the lead-time filter with the status and the rep', async () => {
      const repo = await makeRepo();
      const customerId = newId();
      const wanted = await repo.create(newQuote({ customerId, salesRep: 'jsmith' }));
      await repo.create(newQuote({ customerId, salesRep: 'rlee' }));
      const requested = await repo.create(newQuote({ customerId, salesRep: 'jsmith' }));
      await repo.transition(requested.id, 'override_requested', NOW);

      const drafts = await repo.list({
        customerIds: [customerId],
        status: 'draft',
        salesRep: 'jsmith',
        leadTime: 'missing',
      });
      expect(drafts.map((q) => q.id)).toEqual([wanted.id]);
      const asked = await repo.list({
        customerIds: [customerId],
        status: 'override_requested',
        leadTime: 'missing',
      });
      expect(asked.map((q) => q.id)).toEqual([requested.id]);
    });

    it('summarises a quote with no lines as zeros and no hand-set price', async () => {
      const repo = await makeRepo();
      const input = await repo.create(newQuote());

      const [listed] = await repo.list({ customerIds: [input.customerId] });
      expect(listed).toMatchObject({
        lineCount: 0,
        belowFloorCount: 0,
        manualCount: 0,
        manualPricePerRoll: null,
      });
    });

    it('counts the lines, the below-floor ones and the hand-set ones', async () => {
      const repo = await makeRepo();
      const input = await repo.create(newQuote());
      await repo.replaceLines(
        input.id,
        [
          newLine({ lineNumber: 1 }),
          newLine({
            lineNumber: 2,
            priceSource: 'manual',
            overridePricePerRoll: '11.5000',
            pricePerRoll: '11.5000',
            marginPct: '0.082600',
            floor: { status: 'below_floor', floorPct: '0.120000', minimumPricePerRoll: '11.9885' },
          }),
        ],
        NOW,
      );

      const [listed] = await repo.list({ customerIds: [input.customerId] });
      expect(listed).toMatchObject({
        lineCount: 2,
        belowFloorCount: 1,
        manualCount: 1,
        manualPricePerRoll: '11.5000',
      });
    });

    it('names the first hand-set line by line number when there are two', async () => {
      const repo = await makeRepo();
      const input = await repo.create(newQuote());

      await repo.replaceLines(
        input.id,
        [
          newLine({
            lineNumber: 2,
            priceSource: 'manual',
            overridePricePerRoll: '16.2500',
            pricePerRoll: '16.2500',
          }),
          newLine({
            lineNumber: 1,
            priceSource: 'manual',
            overridePricePerRoll: '12.7500',
            pricePerRoll: '12.7500',
          }),
        ],
        NOW,
      );

      const [listed] = await repo.list({ customerIds: [input.customerId] });
      expect(listed).toMatchObject({
        lineCount: 2,
        belowFloorCount: 0,
        manualCount: 2,
        manualPricePerRoll: '12.7500',
      });

      expect(() => quoteListItemSchema.parse(listed)).not.toThrow();
    });

    it('stores a line at the agreed price unchanged, and does not count it as hand-set', async () => {
      const repo = await makeRepo();
      const input = await repo.create(newQuote());
      await repo.replaceLines(
        input.id,
        [
          newLine({
            lineNumber: 1,
            priceSource: 'agreed',
            overridePricePerRoll: '13.8500',
            pricePerRoll: '13.8500',
          }),
        ],
        NOW,
      );

      const stored = await repo.findWithLines(input.id);
      expect(stored?.lines[0]).toMatchObject({
        priceSource: 'agreed',
        overridePricePerRoll: '13.8500',
      });
      const [listed] = await repo.list({ customerIds: [input.customerId] });
      expect(listed).toMatchObject({ lineCount: 1, manualCount: 0, manualPricePerRoll: null });
    });
  });

  describe('the quote number', () => {
    it('mints a number for a first version the caller left unnumbered', async () => {
      const repo = await makeRepo();
      const first = await repo.create(newQuote());
      const second = await repo.create(newQuote());

      expect(first.quoteNumber).toBeGreaterThan(0);
      expect(second.quoteNumber).toBeGreaterThan(first.quoteNumber);

      expect((await repo.findById(first.id))?.quoteNumber).toBe(first.quoteNumber);
    });

    it('keeps the number a revision carries, so the chain shares it', async () => {
      const repo = await makeRepo();
      const v1 = await repo.create(newQuote());
      await repo.replaceLines(v1.id, [newLine()], NOW);
      await repo.transition(v1.id, 'quoted', NOW);

      const v2 = await repo.revise(
        v1.id,
        {
          ...newQuote(),
          customerId: v1.customerId,
          rootQuoteId: v1.rootQuoteId,
          versionNumber: 2,
          quoteNumber: v1.quoteNumber,
          createdAt: LATER,
          updatedAt: LATER,
        },
        [newLine()],
        LATER,
      );

      expect(v2).toMatchObject({ versionNumber: 2, quoteNumber: v1.quoteNumber });
      expect((await repo.versions(v1.rootQuoteId)).map((q) => q.quoteNumber)).toEqual([
        v1.quoteNumber,
        v1.quoteNumber,
      ]);
    });

    it('finds every version of a quote by its number, and nothing else', async () => {
      const repo = await makeRepo();
      const v1 = await repo.create(newQuote());
      await repo.replaceLines(v1.id, [newLine()], NOW);
      await repo.transition(v1.id, 'quoted', NOW);
      const next = {
        ...newQuote(),
        customerId: v1.customerId,
        rootQuoteId: v1.rootQuoteId,
        versionNumber: 2,
        quoteNumber: v1.quoteNumber,
        createdAt: LATER,
        updatedAt: LATER,
      };
      await repo.revise(v1.id, next, [newLine()], LATER);
      await repo.create(newQuote({ customerId: v1.customerId }));

      const found = await repo.list({ quoteNumber: v1.quoteNumber });
      expect(found.map((q) => q.id).sort()).toEqual([v1.id, next.id].sort());
    });

    it('lists the quotes of any of several customers, and none for an empty list', async () => {
      const repo = await makeRepo();
      const a = await repo.create(newQuote());
      const b = await repo.create(newQuote());
      await repo.create(newQuote());

      const found = await repo.list({ customerIds: [a.customerId, b.customerId] });
      expect(found.map((q) => q.id).sort()).toEqual([a.id, b.id].sort());
      expect(await repo.list({ customerIds: [] })).toEqual([]);
    });

    it('lists the quotes named by id, any of several; an empty list matches nothing', async () => {
      const repo = await makeRepo();
      const a = await repo.create(newQuote());
      await repo.create(newQuote());
      const c = await repo.create(newQuote());

      const found = await repo.list({ ids: [a.id, c.id] });
      expect(found.map((q) => q.id).sort()).toEqual([a.id, c.id].sort());
      expect(await repo.list({ ids: [] })).toEqual([]);
      expect((await repo.countAndOldest({ ids: [a.id] })).count).toBe(1);
      expect(await repo.countAndOldest({ ids: [] })).toEqual({ count: 0, oldest: null });
    });
  });

  describe('replaceLines', () => {
    it('stores a line and reads it back with every figure intact', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      const line = newLine();

      const saved = await repo.replaceLines(input.id, [line], NOW);
      const [stored] = saved?.lines ?? [];

      expect(stored).toMatchObject({
        quoteId: input.id,
        lineNumber: 1,
        gradeId,
        footageVariant: 'short',
        rollWidthIn: 24,
        quantityRolls: 1150,
        overwrap: false,
        pallets: 23,
        pricePerRoll: '13.3543',
        extendedPrice: '15357.4450',
        marginPct: '0.210000',
      });
    });

    it("round-trips the customer's part number and description, and their absence", async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(
        input.id,
        [
          newLine({ customerPartNumber: 'LN-1300-C', customerDescription: 'CEDAR CORE SHEET' }),
          newLine({ lineNumber: 2 }),
        ],
        NOW,
      );
      const reread = await repo.findWithLines(input.id);

      expect(reread?.lines[0]).toMatchObject({
        customerPartNumber: 'LN-1300-C',
        customerDescription: 'CEDAR CORE SHEET',
      });

      expect(Object.hasOwn(reread?.lines[1] ?? {}, 'customerPartNumber')).toBe(false);
      expect(Object.hasOwn(reread?.lines[1] ?? {}, 'customerDescription')).toBe(false);
      expect(saved?.lines).toHaveLength(2);
    });

    it('round-trips a per-pound line with its price per pound', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(
        input.id,
        [
          newLine({
            pricingBasis: 'per_pound',
            productPricePerLb: '0.5873',

            basePricePerLb: '0.5873',

            orderedWeightLb: '1000.0000',
          }),
        ],
        NOW,
      );

      expect(saved?.lines[0]).toMatchObject({
        pricingBasis: 'per_pound',
        productPricePerLb: '0.5873',
        basePricePerLb: '0.5873',
        orderedWeightLb: '1000.0000',
      });
    });

    it('round-trips a hand-set price per pound with what it replaced', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(
        input.id,
        [
          newLine({
            pricingBasis: 'per_pound',
            priceSource: 'manual',
            overridePricePerLb: '0.6850',
            productPricePerLb: '0.6850',
            basePricePerLb: '0.5873',
            orderedWeightLb: '1000.0000',
          }),
        ],
        NOW,
      );

      expect(saved?.lines[0]).toMatchObject({
        pricingBasis: 'per_pound',
        priceSource: 'manual',
        overridePricePerLb: '0.6850',
        productPricePerLb: '0.6850',
        basePricePerLb: '0.5873',
      });
    });

    it('reads a per-roll line back with NO price per pound', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(input.id, [newLine()], NOW);
      const stored = saved?.lines[0];

      expect(stored?.pricingBasis).toBe('per_roll');
      expect(stored?.productPricePerLb).toBeUndefined();
      expect(Object.hasOwn(stored ?? {}, 'productPricePerLb')).toBe(false);

      expect(Object.hasOwn(stored ?? {}, 'basePricePerLb')).toBe(false);
      expect(Object.hasOwn(stored ?? {}, 'overridePricePerLb')).toBe(false);

      expect(Object.hasOwn(stored ?? {}, 'marginOverridePct')).toBe(false);
      expect(Object.hasOwn(stored ?? {}, 'marginPricePerRoll')).toBe(false);
    });

    it('round-trips a margin entered manually with its price and the tier beside it', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      await repo.replaceLines(
        input.id,
        [
          newLine({
            priceSource: 'margin',
            marginOverridePct: '0.437000',
            marginPricePerRoll: '18.7387',
            pricePerRoll: '18.7387',
            marginPct: '0.437000',
          }),
        ],
        NOW,
      );
      const reread = await repo.findWithLines(input.id);

      expect(reread?.lines[0]).toMatchObject({
        priceSource: 'margin',
        marginOverridePct: '0.437000',
        marginPricePerRoll: '18.7387',
        pricePerRoll: '18.7387',
        basePricePerRoll: '13.3543',
      });
      expect(Object.hasOwn(reread?.lines[0] ?? {}, 'tierOverrideCode')).toBe(false);
    });

    it('carries a margin entered manually into a revision', async () => {
      const repo = await makeRepo();
      const v1 = await repo.create(newQuote());
      const saved = await repo.replaceLines(
        v1.id,
        [
          newLine({
            priceSource: 'margin',
            marginOverridePct: '0.437000',
            marginPricePerRoll: '18.7387',
            pricePerRoll: '18.7387',
          }),
        ],
        NOW,
      );
      await repo.transition(v1.id, 'quoted', NOW);
      const copied = (saved?.lines ?? []).map((line) => ({ ...line, id: newId() }));

      const v2 = await repo.revise(
        v1.id,
        {
          ...newQuote(),
          customerId: v1.customerId,
          rootQuoteId: v1.rootQuoteId,
          versionNumber: 2,
          quoteNumber: v1.quoteNumber,
          createdAt: LATER,
          updatedAt: LATER,
        },
        copied,
        LATER,
      );

      expect(v2?.lines[0]).toMatchObject({
        priceSource: 'margin',
        marginOverridePct: '0.437000',
        marginPricePerRoll: '18.7387',
      });
    });

    it('keeps sub-cent precision on paper cost per pound', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(input.id, [newLine()], NOW);
      expect(saved?.lines[0]?.cost.paperCostPerLb).toBe('0.46266422');
    });

    it('returns a quote the wire contract accepts', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(input.id, [newLine()], NOW);
      expect(() => quoteWithLinesSchema.parse(saved)).not.toThrow();
    });

    it('round-trips the cost build-up limb by limb', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      const line = newLine();

      const saved = await repo.replaceLines(input.id, [line], NOW);
      expect(saved?.lines[0]?.cost).toEqual(line.cost);
    });

    it('round-trips the tier snapshot', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      const line = newLine();

      const saved = await repo.replaceLines(input.id, [line], NOW);
      expect(saved?.lines[0]?.tier).toEqual(line.tier);
    });

    it('round-trips a below-floor result, detail and all', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(
        input.id,
        [
          newLine({
            marginPct: '0.075000',
            floor: {
              status: 'below_floor',
              floorPct: '0.120000',
              minimumPricePerRoll: '11.9885',
            },
          }),
        ],
        NOW,
      );

      expect(saved?.lines[0]?.floor).toEqual({
        status: 'below_floor',
        floorPct: '0.120000',
        minimumPricePerRoll: '11.9885',
      });
    });

    it('omits absent optional inputs rather than surfacing null', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(input.id, [newLine()], NOW);
      const stored = saved?.lines[0] as QuoteLine;

      expect(stored).not.toHaveProperty('tierOverrideCode');
      expect(stored).not.toHaveProperty('feetPerRollOverride');
    });

    it('keeps the optional inputs that were supplied', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(
        input.id,
        [
          newLine({
            tierOverrideCode: 'RETAIL',
            feetPerRollOverride: '1250.0000',
            convertCostPerTon: '63.5000',
            printCostPerTon: '41.2500',
          }),
        ],
        NOW,
      );

      expect(saved?.lines[0]).toMatchObject({
        tierOverrideCode: 'RETAIL',
        feetPerRollOverride: '1250.0000',
        convertCostPerTon: '63.5000',
        printCostPerTon: '41.2500',
      });
    });

    it('round-trips each freight mode with its own field set', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const modes: NewQuoteLine['freight'][] = [
        { mode: 'pickup' },
        { mode: 'our_vehicle', rateOverride: '36.7500' },
        { mode: 'pass_through', rateOverride: '19.2500', carrierBid: '67.0000' },
        { mode: 'carrier', carrierBid: '395.0000', freightMarginPct: '0.220000' },
      ];

      const saved = await repo.replaceLines(
        input.id,
        modes.map((freight, i) => newLine({ lineNumber: i + 1, freight })),
        NOW,
      );

      expect(saved?.lines.map((l) => l.freight)).toEqual(modes);
    });

    it('round-trips a delivery address across its six columns', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const deliveryAddress = {
        name: 'Harbor Receiving',
        line1: '200 Example Way',
        line2: 'Dock 3',
        city: 'Sample Harbor',
        state: 'WA',
        postalCode: '98000-4170',
      };

      const saved = await repo.replaceLines(input.id, [newLine({ deliveryAddress })], NOW);

      expect(saved?.lines[0]?.deliveryAddress).toEqual(deliveryAddress);
    });

    it('carries a different destination on each line of one quote', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const harbor = {
        line1: '200 Example Way',
        city: 'Sample Harbor',
        state: 'WA',
        postalCode: '98000',
      };
      const falls = {
        line1: '500 Example Way',
        city: 'Demo Falls',
        state: 'ID',
        postalCode: '83010',
      };

      const saved = await repo.replaceLines(
        input.id,
        [
          newLine({ lineNumber: 1, deliveryAddress: harbor }),
          newLine({ lineNumber: 2, deliveryAddress: falls }),
        ],
        NOW,
      );

      expect(saved?.lines.map((l) => l.deliveryAddress)).toEqual([harbor, falls]);
    });

    it('omits an absent address rather than surfacing a hollow one', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(input.id, [newLine()], NOW);

      expect(saved?.lines[0]).not.toHaveProperty('deliveryAddress');
    });

    it('keeps an address that omits its optional parts', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const deliveryAddress = {
        line1: '200 Example Way',
        city: 'Sample Harbor',
        state: 'WA',
        postalCode: '98000',
      };

      const saved = await repo.replaceLines(input.id, [newLine({ deliveryAddress })], NOW);
      const stored = saved?.lines[0]?.deliveryAddress;

      expect(stored).toEqual(deliveryAddress);
      expect(stored).not.toHaveProperty('name');
      expect(stored).not.toHaveProperty('line2');
    });

    it('keeps a pending carrier line distinguishable from a free pickup', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const pendingResult = {
        mode: 'carrier' as const,
        cost: '0.0000',
        margin: '0.0000',
        invoiceTotal: '0.0000',
        pending: true,
      };

      const saved = await repo.replaceLines(
        input.id,
        [
          newLine({ lineNumber: 1, freight: { mode: 'carrier' }, freightResult: pendingResult }),
          newLine({ lineNumber: 2 }),
        ],
        NOW,
      );

      expect(saved?.lines[0]?.freightResult.pending).toBe(true);
      expect(saved?.lines[1]?.freightResult.pending).toBe(false);

      expect(saved?.lines[0]?.freightResult.invoiceTotal).toBe(
        saved?.lines[1]?.freightResult.invoiceTotal,
      );
    });

    it('round-trips a pass_through line whose last-leg bid has not arrived', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(
        input.id,
        [
          newLine({
            lineNumber: 1,
            freight: { mode: 'pass_through', rateOverride: '19.2500' },
            freightResult: {
              mode: 'pass_through',
              cost: '19.2500',
              margin: '0.0000',
              invoiceTotal: '19.2500',
              pending: true,
            },
          }),
        ],
        NOW,
      );

      expect(saved?.lines[0]?.freight).toEqual({ mode: 'pass_through', rateOverride: '19.2500' });
      expect(saved?.lines[0]?.freightResult.pending).toBe(true);

      expect(saved?.lines[0]?.freightResult.invoiceTotal).toBe('19.2500');
    });

    it('keeps a partially-known pass_through line distinct from an unknown carrier line', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(
        input.id,
        [
          newLine({
            lineNumber: 1,
            freight: { mode: 'pass_through' },
            freightResult: {
              mode: 'pass_through',
              cost: '19.2500',
              margin: '0.0000',
              invoiceTotal: '19.2500',
              pending: true,
            },
          }),
          newLine({
            lineNumber: 2,
            freight: { mode: 'carrier' },
            freightResult: {
              mode: 'carrier',
              cost: '0.0000',
              margin: '0.0000',
              invoiceTotal: '0.0000',
              pending: true,
            },
          }),
        ],
        NOW,
      );

      const [partial, unknown] = saved?.lines ?? [];
      expect(partial?.freightResult.pending).toBe(true);
      expect(unknown?.freightResult.pending).toBe(true);
      expect(freightKnowledge(partial!.freightResult)).toBe('partial');
      expect(freightKnowledge(unknown!.freightResult)).toBe('unknown');
      expect(partial?.freightResult.invoiceTotal).not.toBe(unknown?.freightResult.invoiceTotal);
    });

    it('keeps freight cost and margin apart rather than storing only the total', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(
        input.id,
        [
          newLine({
            freight: { mode: 'carrier', carrierBid: '395.0000', freightMarginPct: '0.185000' },
            freightResult: {
              mode: 'carrier',
              cost: '395.0000',
              margin: '89.6626',
              invoiceTotal: '484.6626',
              pending: false,
            },
          }),
        ],
        NOW,
      );

      expect(saved?.lines[0]?.freightResult).toMatchObject({
        cost: '395.0000',
        margin: '89.6626',
        invoiceTotal: '484.6626',
      });
    });

    it('omits absent freight fields rather than surfacing null', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(
        input.id,
        [newLine({ freight: { mode: 'carrier' } })],
        NOW,
      );
      const freight = saved?.lines[0]?.freight as { mode: string };

      expect(freight).toEqual({ mode: 'carrier' });
      expect(freight).not.toHaveProperty('carrierBid');
      expect(freight).not.toHaveProperty('freightMarginPct');
    });

    it('round-trips a hand-set price and its source', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(
        input.id,
        [newLine({ priceSource: 'manual', overridePricePerRoll: '16.4000' })],
        NOW,
      );

      expect(saved?.lines[0]).toMatchObject({
        priceSource: 'manual',
        overridePricePerRoll: '16.4000',

        basePricePerRoll: '13.3543',
      });
    });

    it('omits the override on a tier-priced line rather than nulling it', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(input.id, [newLine()], NOW);

      expect(saved?.lines[0]?.priceSource).toBe('tier');
      expect(saved?.lines[0]).not.toHaveProperty('overridePricePerRoll');
    });

    it('returns lines in lineNumber order regardless of the order supplied', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(
        input.id,
        [newLine({ lineNumber: 3 }), newLine({ lineNumber: 1 }), newLine({ lineNumber: 2 })],
        NOW,
      );

      expect(saved?.lines.map((l) => l.lineNumber)).toEqual([1, 2, 3]);
    });

    it('replaces wholesale — old lines do not survive', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(
        input.id,
        [newLine({ lineNumber: 1 }), newLine({ lineNumber: 2 })],
        NOW,
      );

      const saved = await repo.replaceLines(input.id, [newLine({ quantityRolls: 7 })], LATER);

      expect(saved?.lines).toHaveLength(1);
      expect(saved?.lines[0]?.quantityRolls).toBe(7);
    });

    it('accepts an empty list, which clears the quote', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine()], NOW);

      const saved = await repo.replaceLines(input.id, [], LATER);
      expect(saved?.lines).toEqual([]);
    });

    it('moves the header updatedAt, because re-pricing changes the quote', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(input.id, [newLine()], LATER);
      expect(saved?.updatedAt).toBe(LATER.toISOString());
    });

    it('stamps every line with the same instant', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const saved = await repo.replaceLines(
        input.id,
        [newLine({ lineNumber: 1 }), newLine({ lineNumber: 2 })],
        LATER,
      );

      expect(saved?.lines.map((l) => l.updatedAt)).toEqual([
        LATER.toISOString(),
        LATER.toISOString(),
      ]);
    });

    it('returns null for an unknown quote rather than throwing', async () => {
      const repo = await makeRepo();
      expect(await repo.replaceLines(newId(), [newLine()], NOW)).toBeNull();
    });

    it('does not touch another quote/s lines', async () => {
      const repo = await makeRepo();
      const a = newQuote();
      const b = newQuote();
      await repo.create(a);
      await repo.create(b);
      await repo.replaceLines(a.id, [newLine()], NOW);
      await repo.replaceLines(b.id, [newLine(), newLine({ lineNumber: 2 })], NOW);

      expect((await repo.findWithLines(a.id))?.lines).toHaveLength(1);
      expect((await repo.findWithLines(b.id))?.lines).toHaveLength(2);
    });
  });

  describe('versions', () => {
    it('is empty, not null, for a root nobody has', async () => {
      expect(await (await makeRepo()).versions(newId())).toEqual([]);
    });

    it('returns a single-version chain', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const chain = await repo.versions(input.rootQuoteId);
      expect(chain.map((q) => q.versionNumber)).toEqual([1]);
    });

    it('does not mix two chains together', async () => {
      const repo = await makeRepo();
      const a = newQuote();
      const b = newQuote();
      await repo.create(a);
      await repo.create(b);

      expect(await repo.versions(a.rootQuoteId)).toHaveLength(1);
      expect(await repo.versions(b.rootQuoteId)).toHaveLength(1);
    });
  });

  describe('recordSend / sendsForChain', () => {
    const newSend = (quoteId: string, over: Partial<NewQuoteSend> = {}): NewQuoteSend => ({
      id: newId(),
      quoteId,
      messageId: `<${newId()}@erp.org.example.test>`,
      actor: 'demo-contributor',
      acceptedByRelayAt: NOW,
      ...over,
    });

    it('is empty, not null, for a chain nobody has sent', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      expect(await repo.sendsForChain(input.rootQuoteId)).toEqual([]);
    });

    it('round-trips a send record', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const send = newSend(input.id);
      const stored = await repo.recordSend(send);

      expect(stored.quoteId).toBe(input.id);
      expect(stored.messageId).toBe(send.messageId);
      expect(stored.actor).toBe('demo-contributor');
      expect(stored.acceptedByRelayAt).toBe(NOW.toISOString());
    });

    it('refuses a blank message id', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      await expect(repo.recordSend(newSend(input.id, { messageId: '   ' }))).rejects.toThrow();
    });

    it('does not mix two chains together', async () => {
      const repo = await makeRepo();
      const a = newQuote();
      const b = newQuote();
      await repo.create(a);
      await repo.create(b);
      await repo.recordSend(newSend(a.id));

      expect(await repo.sendsForChain(a.rootQuoteId)).toHaveLength(1);
      expect(await repo.sendsForChain(b.rootQuoteId)).toEqual([]);
    });

    it('returns sends oldest first', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.recordSend(newSend(input.id, { acceptedByRelayAt: LATER }));
      await repo.recordSend(newSend(input.id, { acceptedByRelayAt: NOW }));

      const sends = await repo.sendsForChain(input.rootQuoteId);
      expect(sends.map((s) => s.acceptedByRelayAt)).toEqual([
        NOW.toISOString(),
        LATER.toISOString(),
      ]);
    });

    it('reports a prior version_s send against the whole chain', async () => {
      const repo = await makeRepo();
      const v1 = newQuote();
      await repo.create(v1);
      await repo.replaceLines(v1.id, [newLine()], NOW);
      await repo.transition(v1.id, 'quoted', NOW);
      await repo.recordSend(newSend(v1.id));

      const v2 = { ...newQuote(), rootQuoteId: v1.rootQuoteId, versionNumber: 2 };
      await repo.revise(v1.id, v2, [newLine()], LATER);

      const chain = await repo.sendsForChain(v1.rootQuoteId);
      expect(chain.every((s) => s.quoteId !== v2.id)).toBe(true);

      expect(chain).toHaveLength(1);
      expect(chain[0]?.quoteId).toBe(v1.id);
    });
  });

  describe('revise', () => {
    const sentQuote = async (repo: QuoteRepository) => {
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine()], NOW);
      await repo.transition(input.id, 'quoted', NOW);
      return input;
    };

    const nextVersion = (original: ReturnType<typeof newQuote>) => ({
      ...newQuote(),
      id: newId(),
      customerId: original.customerId,
      rootQuoteId: original.rootQuoteId,
      versionNumber: original.versionNumber + 1,
      status: 'draft' as const,
      createdAt: LATER,
      updatedAt: LATER,
    });

    it('mints the next version and supersedes the original', async () => {
      const repo = await makeRepo();
      const original = await sentQuote(repo);
      const next = nextVersion(original);

      const revised = await repo.revise(original.id, next, [newLine()], LATER);

      expect(revised).toMatchObject({ id: next.id, versionNumber: 2, status: 'draft' });
      expect((await repo.findById(original.id))?.status).toBe('superseded');
    });

    it('carries the lines forward at the prices the original was quoted at', async () => {
      const repo = await makeRepo();
      const original = await sentQuote(repo);
      const before = (await repo.findWithLines(original.id))?.lines[0] as QuoteLine;

      const carried: NewQuoteLine = { ...before, id: newId() };

      const revised = await repo.revise(original.id, nextVersion(original), [carried], LATER);
      const after = revised?.lines[0];

      expect(after?.pricePerRoll).toBe(before?.pricePerRoll);
      expect(after?.extendedPrice).toBe(before?.extendedPrice);
      expect(after?.tier).toEqual(before?.tier);
      expect(after?.cost).toEqual(before?.cost);
    });

    it('leaves the superseded version readable at its own prices', async () => {
      const repo = await makeRepo();
      const original = await sentQuote(repo);
      await repo.revise(original.id, nextVersion(original), [newLine()], LATER);

      const old = await repo.findWithLines(original.id);
      expect(old?.status).toBe('superseded');
      expect(old?.lines).toHaveLength(1);
      expect(old?.lines[0]?.pricePerRoll).toBe('13.3543');
    });

    it('puts both versions in one queryable chain, oldest first', async () => {
      const repo = await makeRepo();
      const original = await sentQuote(repo);
      const next = nextVersion(original);
      await repo.revise(original.id, next, [newLine()], LATER);

      const chain = await repo.versions(original.rootQuoteId);
      expect(chain.map((q) => q.versionNumber)).toEqual([1, 2]);
      expect(chain.map((q) => q.id)).toEqual([original.id, next.id]);
    });

    it('leaves exactly one version outside superseded — the current one', async () => {
      const repo = await makeRepo();
      const original = await sentQuote(repo);
      await repo.revise(original.id, nextVersion(original), [newLine()], LATER);

      const live = (await repo.versions(original.rootQuoteId)).filter(
        (q) => q.status !== 'superseded',
      );
      expect(live).toHaveLength(1);
      expect(live[0]?.versionNumber).toBe(2);
    });

    it('refuses a second revision of the same original, and writes nothing', async () => {
      const repo = await makeRepo();
      const original = await sentQuote(repo);
      await repo.revise(original.id, nextVersion(original), [newLine()], LATER);
      const superseded = await repo.findById(original.id);
      const second = { ...nextVersion(original), versionNumber: 3 };

      await expect(repo.revise(original.id, second, [newLine()], LATER)).rejects.toThrow(
        QuoteNotRevisableError,
      );

      expect(await repo.findById(original.id)).toEqual(superseded);
      expect(await repo.findById(second.id)).toBeNull();
      expect(await repo.versions(original.rootQuoteId)).toHaveLength(2);
    });

    it('refuses a revision whose version number is already taken, and writes nothing', async () => {
      const repo = await makeRepo();
      const original = await sentQuote(repo);
      await repo.create(nextVersion(original));
      const before = await repo.findById(original.id);
      const clash = nextVersion(original);

      await expect(repo.revise(original.id, clash, [newLine()], LATER)).rejects.toThrow(
        QuoteVersionConflictError,
      );

      expect(await repo.findById(original.id)).toEqual(before);
      expect(await repo.findById(clash.id)).toBeNull();
    });

    it('refuses to revise a quote that is no longer quoted, and writes nothing', async () => {
      const repo = await makeRepo();
      const original = await sentQuote(repo);
      await repo.transition(original.id, 'closed_lost', LATER);
      const closed = await repo.findById(original.id);
      const next = nextVersion(original);

      await expect(repo.revise(original.id, next, [newLine()], LATER)).rejects.toThrow(
        QuoteNotRevisableError,
      );

      expect(await repo.findById(original.id)).toEqual(closed);
      expect(await repo.findById(next.id)).toBeNull();
      expect(await repo.versions(original.rootQuoteId)).toHaveLength(1);
    });

    it('refuses a revision at a stale lockVersion, and writes nothing', async () => {
      const repo = await makeRepo();
      const original = await sentQuote(repo);
      const read = await repo.findById(original.id);
      const next = nextVersion(original);

      await expect(
        repo.revise(original.id, next, [newLine()], LATER, read!.lockVersion - 1),
      ).rejects.toThrow(StaleAggregateError);

      expect(await repo.findById(original.id)).toEqual(read);
      expect(await repo.findById(next.id)).toBeNull();
    });

    it('lets a revision or a close win, never both', async () => {
      const repo = await makeRepo();
      const original = await sentQuote(repo);
      const read = await repo.findById(original.id);
      const next = nextVersion(original);

      const [revised, closed] = await Promise.allSettled([
        repo.revise(original.id, next, [newLine()], LATER, read!.lockVersion),
        repo.transition(original.id, 'closed_lost', LATER, read!.lockVersion),
      ]);

      const status = (await repo.findById(original.id))?.status;
      const minted = await repo.findById(next.id);
      expect([revised.status, closed.status].sort()).toEqual(['fulfilled', 'rejected']);
      if (revised.status === 'fulfilled') {
        expect(status).toBe('superseded');
        expect(minted?.status).toBe('draft');
      } else {
        expect(status).toBe('closed_lost');
        expect(minted).toBeNull();
      }
    });

    it('returns null for an unknown original rather than throwing', async () => {
      const repo = await makeRepo();
      const orphan = newQuote();
      expect(await repo.revise(newId(), nextVersion(orphan), [newLine()], LATER)).toBeNull();
    });

    it('copies an empty quote forward as an empty quote', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.transition(input.id, 'quoted', NOW);

      const revised = await repo.revise(input.id, nextVersion(input), [], LATER);
      expect(revised?.lines).toEqual([]);
      expect((await repo.findById(input.id))?.status).toBe('superseded');
    });
  });

  describe('draftLinesUsingGradeVariant', () => {
    it('finds a draft line using the variant', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine({ footageVariant: 'short' })], NOW);

      expect(await repo.draftLinesUsingGradeVariant(gradeId, 'short')).toEqual([
        { quoteId: input.id, lineNumber: 1 },
      ]);
    });

    it('ignores lines on a quote that is no longer a draft', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine({ footageVariant: 'short' })], NOW);
      await repo.transition(input.id, 'quoted', LATER);

      expect(await repo.draftLinesUsingGradeVariant(gradeId, 'short')).toEqual([]);
    });

    it('matches on the variant and the grade together, not either alone', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine({ footageVariant: 'short' })], NOW);

      expect(await repo.draftLinesUsingGradeVariant(gradeId, 'long')).toEqual([]);

      expect(await repo.draftLinesUsingGradeVariant(newId(), 'short')).toEqual([]);
    });

    it('returns empty for a grade nothing references', async () => {
      const repo = await makeRepo();
      expect(await repo.draftLinesUsingGradeVariant(newId(), 'short')).toEqual([]);
    });

    it('orders its hits so a refusal message is stable', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(
        input.id,
        [
          newLine({ lineNumber: 1, footageVariant: 'short' }),
          newLine({ lineNumber: 2, footageVariant: 'short' }),
        ],
        NOW,
      );

      expect(await repo.draftLinesUsingGradeVariant(gradeId, 'short')).toEqual([
        { quoteId: input.id, lineNumber: 1 },
        { quoteId: input.id, lineNumber: 2 },
      ]);
    });
  });

  describe('draftLinesUsingGradeWidth', () => {
    it('finds a draft line using the width as a stock width', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine({ rollWidthIn: 24 })], NOW);

      expect(await repo.draftLinesUsingGradeWidth(gradeId, 24)).toEqual([
        { quoteId: input.id, lineNumber: 1 },
      ]);
      expect(await repo.draftLinesUsingGradeWidth(gradeId, 12)).toEqual([]);
      expect(await repo.draftLinesUsingGradeWidth(newId(), 24)).toEqual([]);
    });

    it('ignores a line stored as a custom width', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine({ rollWidthIn: 24, customWidth: true })], NOW);

      expect(await repo.draftLinesUsingGradeWidth(gradeId, 24)).toEqual([]);
    });

    it('ignores lines on a quote that is no longer a draft', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine({ rollWidthIn: 24 })], NOW);
      await repo.transition(input.id, 'quoted', LATER);

      expect(await repo.draftLinesUsingGradeWidth(gradeId, 24)).toEqual([]);
    });
  });

  describe('customWidth', () => {
    it('round-trips the mark, and a line saved without it reads as a stock width', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(
        input.id,
        [
          newLine({ lineNumber: 1, rollWidthIn: 17, customWidth: true }),
          newLine({ lineNumber: 2, rollWidthIn: 24 }),
        ],
        NOW,
      );

      const stored = await repo.findWithLines(input.id);
      expect(stored?.lines.map((line) => line.customWidth ?? false)).toEqual([true, false]);
    });
  });

  describe('a width with no rolls-per-pallet count', () => {
    it('stores the pallet count and the count it came from as null, never zero', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      const base = newLine();
      await repo.replaceLines(
        input.id,
        [
          newLine({
            lineNumber: 1,
            rollWidthIn: 9,
            cost: { ...base.cost, hardwareCostPerRoll: '0.8317', rollsPerPallet: null },
            pallets: null,
          }),
          newLine({ lineNumber: 2 }),
        ],
        NOW,
      );

      const stored = await repo.findWithLines(input.id);
      expect(stored?.lines.map((line) => [line.pallets, line.cost.rollsPerPallet])).toEqual([
        [null, null],
        [23, 50],
      ]);
      expect(stored?.lines[0]?.cost.hardwareCostPerRoll).toBe('0.8317');
    });
  });

  describe('a stock width in sixteenths', () => {
    it('reads the width back as the number it went in as', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(
        input.id,
        [newLine({ lineNumber: 1, rollWidthIn: 9.75 }), newLine({ lineNumber: 2 })],
        NOW,
      );

      const stored = await repo.findWithLines(input.id);
      expect(stored?.lines.map((line) => line.rollWidthIn)).toEqual([9.75, 24]);
    });
  });

  describe('freightInRollPrice', () => {
    it('reads false on a new quote, the column default', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      const created = await repo.create(input);

      expect(created.freightInRollPrice).toBe(false);
      expect((await repo.findById(input.id))?.freightInRollPrice).toBe(false);
    });

    it('is saved with the lines in one write, moving the token once', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      const before = (await repo.findById(input.id))!.lockVersion;

      const saved = await repo.replaceLines(input.id, [newLine()], LATER, before, {
        freightInRollPrice: true,
      });

      expect(saved?.freightInRollPrice).toBe(true);
      expect(saved?.lockVersion).toBe(before + 1);
      expect((await repo.findById(input.id))?.freightInRollPrice).toBe(true);
    });

    it('keeps the stored flag when a save leaves it out, as the Lines step does', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine()], NOW, undefined, { freightInRollPrice: true });

      await repo.replaceLines(input.id, [newLine({ quantityRolls: 10 })], LATER);

      expect((await repo.findById(input.id))?.freightInRollPrice).toBe(true);
    });

    it('can be cleared again', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine()], NOW, undefined, { freightInRollPrice: true });

      await repo.replaceLines(input.id, [newLine()], LATER, undefined, {
        freightInRollPrice: false,
      });

      expect((await repo.findById(input.id))?.freightInRollPrice).toBe(false);
    });

    it('is not written when the guarded save is stale', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      const stale = (await repo.findById(input.id))!.lockVersion;
      await repo.replaceLines(input.id, [newLine()], NOW);

      await expect(
        repo.replaceLines(input.id, [newLine()], LATER, stale, { freightInRollPrice: true }),
      ).rejects.toBeInstanceOf(StaleAggregateError);
      expect((await repo.findById(input.id))?.freightInRollPrice).toBe(false);
    });

    it('survives a transition, an override decision and a lead time', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine()], NOW, undefined, { freightInRollPrice: true });

      await repo.transition(input.id, 'override_requested', LATER);
      await repo.recordOverrideDecision(
        input.id,
        { by: 'bmanager', at: LATER },
        {
          id: newId(),
          decision: 'approved',
          kind: 'price',
          actor: 'bmanager',
          at: LATER.toISOString(),
        },
        LATER,
      );
      const current = (await repo.findById(input.id))!.lockVersion;
      await repo.setLeadTime(input.id, 10, 'dev-production-manager', LATER, current);

      expect((await repo.findById(input.id))?.freightInRollPrice).toBe(true);
    });

    it('carries onto a revision when the new version names it', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine()], NOW, undefined, { freightInRollPrice: true });
      await repo.transition(input.id, 'quoted', NOW);
      const next = newQuote({
        id: newId(),
        customerId: input.customerId,
        rootQuoteId: input.rootQuoteId,
        versionNumber: 2,
        freightInRollPrice: true,
        createdAt: LATER,
        updatedAt: LATER,
      });

      const revised = await repo.revise(input.id, next, [newLine()], LATER);

      expect(revised?.freightInRollPrice).toBe(true);
      expect((await repo.findById(input.id))?.freightInRollPrice).toBe(true);
    });
  });

  describe('recordOverrideDecision', () => {
    const DECIDED = new Date('2026-08-07T11:00:00.000Z');

    it('keeps the lead time, who entered it and when, through an approval and a rejection', async () => {
      const repo = await makeRepo();
      const created = await repo.create(newQuote({ salesRep: 'jsmith', notes: 'Rush job' }));
      const timed = (await repo.setLeadTime(
        created.id,
        10,
        'dev-production',
        LATER,
        created.lockVersion,
      ))!;
      expect(timed.leadTimeDays).toBe(10);

      const approved = await repo.recordOverrideDecision(
        created.id,
        { by: 'bmanager', at: DECIDED },
        {
          id: newId(),
          decision: 'approved',
          kind: 'price',
          actor: 'bmanager',
          at: DECIDED.toISOString(),
        },
        DECIDED,
        timed.lockVersion,
      );
      const afterApproval = {
        ...timed,
        overrideApprovedBy: 'bmanager',
        overrideApprovedAt: DECIDED.toISOString(),
        lockVersion: timed.lockVersion + 1,
        updatedAt: DECIDED.toISOString(),
      };
      expect(approved).toEqual(afterApproval);
      expect(await repo.findById(created.id)).toEqual(afterApproval);

      const rejected = await repo.recordOverrideDecision(
        created.id,
        null,
        {
          id: newId(),
          decision: 'rejected',
          kind: 'price',
          actor: 'bmanager',
          at: DECIDED.toISOString(),
        },
        DECIDED,
        afterApproval.lockVersion,
      );

      const afterRejection = {
        ...timed,
        lockVersion: timed.lockVersion + 2,
        updatedAt: DECIDED.toISOString(),
      };
      expect(rejected).toEqual(afterRejection);
      expect(await repo.findById(created.id)).toEqual(afterRejection);
    });

    it('sets and clears only the floor pair on a floor decision, and leaves the price pair', async () => {
      const repo = await makeRepo();
      const created = await repo.create(newQuote());
      const priced = (await repo.recordOverrideDecision(
        created.id,
        { by: 'bmanager', at: LATER },
        {
          id: newId(),
          decision: 'approved',
          kind: 'price',
          actor: 'bmanager',
          at: LATER.toISOString(),
        },
        LATER,
      ))!;

      const floored = await repo.recordOverrideDecision(
        created.id,
        { by: 'dev-admin', at: DECIDED },
        {
          id: newId(),
          decision: 'approved',
          kind: 'floor',
          actor: 'dev-admin',
          reason: 'agreed with finance',
          at: DECIDED.toISOString(),
        },
        DECIDED,
        priced.lockVersion,
      );
      const afterFloor = {
        ...priced,
        floorOverrideBy: 'dev-admin',
        floorOverrideAt: DECIDED.toISOString(),
        lockVersion: priced.lockVersion + 1,
        updatedAt: DECIDED.toISOString(),
      };
      expect(floored).toEqual(afterFloor);
      expect(await repo.findById(created.id)).toEqual(afterFloor);

      const cleared = await repo.recordOverrideDecision(
        created.id,
        null,
        {
          id: newId(),
          decision: 'revoked',
          kind: 'floor',
          actor: 'system:edit',
          at: DECIDED.toISOString(),
        },
        DECIDED,
      );

      const afterClear = {
        ...priced,
        lockVersion: priced.lockVersion + 2,
        updatedAt: DECIDED.toISOString(),
      };
      expect(cleared).toEqual(afterClear);
      expect(await repo.findById(created.id)).toEqual(afterClear);
    });

    it('round-trips the kind on every logged decision', async () => {
      const repo = await makeRepo();
      const created = await repo.create(newQuote());
      for (const kind of ['price', 'floor'] as const) {
        await repo.recordOverrideDecision(
          created.id,
          null,
          {
            id: newId(),
            decision: 'rejected',
            kind,
            actor: 'x',
            reason: 'y',
            at: NOW.toISOString(),
          },
          NOW,
        );
      }

      const log = await repo.overrideDecisions(created.id);
      expect(log.map((d) => d.kind).sort()).toEqual(['floor', 'price']);
    });

    // A quote waiting in the queue, read at the version a decision is guarded by.
    const queuedQuote = async (repo: QuoteRepository) => {
      const created = await repo.create(newQuote());
      return (await repo.transition(created.id, 'override_requested', NOW))!;
    };

    const decisionEntry = (over: { id?: string } = {}) => ({
      id: over.id ?? newId(),
      decision: 'approved' as const,
      kind: 'price' as const,
      actor: 'bmanager',
      at: DECIDED.toISOString(),
    });

    it('records the decision and moves the quote to draft in one write when asked', async () => {
      const repo = await makeRepo();
      const queued = await queuedQuote(repo);
      const entry = decisionEntry();

      const decided = await repo.recordOverrideDecision(
        queued.id,
        { by: 'bmanager', at: DECIDED },
        entry,
        DECIDED,
        queued.lockVersion,
        true,
      );

      const after = {
        ...queued,
        status: 'draft',
        overrideApprovedBy: 'bmanager',
        overrideApprovedAt: DECIDED.toISOString(),
        lockVersion: queued.lockVersion + 1,
        updatedAt: DECIDED.toISOString(),
      };
      expect(decided).toEqual(after);
      expect(await repo.findById(queued.id)).toEqual(after);
      expect(await repo.overrideDecisions(queued.id)).toEqual([{ ...entry, quoteId: queued.id }]);
    });

    it('leaves the status alone when the move is not asked for', async () => {
      const repo = await makeRepo();
      const queued = await queuedQuote(repo);

      const decided = await repo.recordOverrideDecision(
        queued.id,
        { by: 'bmanager', at: DECIDED },
        decisionEntry(),
        DECIDED,
        queued.lockVersion,
      );

      expect(decided?.status).toBe('override_requested');
    });

    it('writes neither the decision nor the move at a stale version', async () => {
      const repo = await makeRepo();
      const queued = await queuedQuote(repo);

      await expect(
        repo.recordOverrideDecision(
          queued.id,
          { by: 'bmanager', at: DECIDED },
          decisionEntry(),
          DECIDED,
          queued.lockVersion - 1,
          true,
        ),
      ).rejects.toThrow(StaleAggregateError);

      expect(await repo.findById(queued.id)).toEqual(queued);
      expect(await repo.overrideDecisions(queued.id)).toEqual([]);
    });

    it('writes neither the approval nor the move when the log entry cannot be written', async () => {
      const repo = await makeRepo();
      const other = await queuedQuote(repo);
      const taken = decisionEntry();
      await repo.recordOverrideDecision(other.id, null, taken, DECIDED);
      const queued = await queuedQuote(repo);

      await expect(
        repo.recordOverrideDecision(
          queued.id,
          { by: 'bmanager', at: DECIDED },
          decisionEntry({ id: taken.id }),
          DECIDED,
          queued.lockVersion,
          true,
        ),
      ).rejects.toThrow();

      expect(await repo.findById(queued.id)).toEqual(queued);
      expect(await repo.overrideDecisions(queued.id)).toEqual([]);
    });
  });

  describe('lockVersion', () => {
    it('starts at 1 on a new quote', async () => {
      const repo = await makeRepo();
      const created = await repo.create(newQuote());
      expect(created.lockVersion).toBe(1);
    });

    it('moves when the LINES change, not just the header', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const before = (await repo.findById(input.id))!.lockVersion;
      await repo.replaceLines(input.id, [newLine()], NOW);
      const after = (await repo.findById(input.id))!.lockVersion;

      expect(after).toBeGreaterThan(before);
    });

    it('moves on a transition and on an override decision', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine()], NOW);

      const beforeMove = (await repo.findById(input.id))!.lockVersion;
      await repo.transition(input.id, 'override_requested', LATER);
      const afterMove = (await repo.findById(input.id))!.lockVersion;
      expect(afterMove).toBeGreaterThan(beforeMove);

      await repo.recordOverrideDecision(
        input.id,
        { by: 'bmanager', at: LATER },
        {
          id: newId(),
          decision: 'approved',
          kind: 'price',
          actor: 'bmanager',
          at: LATER.toISOString(),
        },
        LATER,
      );
      expect((await repo.findById(input.id))!.lockVersion).toBeGreaterThan(afterMove);
    });

    it('does not move `versionNumber` — they are different facts', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine()], NOW);

      const after = (await repo.findById(input.id))!;
      expect(after.versionNumber).toBe(1);
      expect(after.lockVersion).toBeGreaterThan(1);
    });

    it('applies a guarded decision at the expected generation', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine()], NOW);

      const current = (await repo.findById(input.id))!.lockVersion;
      const applied = await repo.recordOverrideDecision(
        input.id,
        { by: 'bmanager', at: LATER },
        {
          id: newId(),
          decision: 'approved',
          kind: 'price',
          actor: 'bmanager',
          at: LATER.toISOString(),
        },
        LATER,
        current,
      );

      expect(applied?.overrideApprovedBy).toBe('bmanager');
    });

    it('refuses a guarded decision at a stale generation, and writes nothing', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine()], NOW);
      const stale = (await repo.findById(input.id))!.lockVersion;

      await repo.replaceLines(input.id, [newLine({ quantityRolls: 7 })], LATER);

      await expect(
        repo.recordOverrideDecision(
          input.id,
          { by: 'bmanager', at: LATER },
          {
            id: newId(),
            decision: 'approved',
            kind: 'price',
            actor: 'bmanager',
            at: LATER.toISOString(),
          },
          LATER,
          stale,
        ),
      ).rejects.toBeInstanceOf(StaleAggregateError);

      expect((await repo.findById(input.id))?.overrideApprovedBy).toBeUndefined();
      expect(await repo.overrideDecisions(input.id)).toEqual([]);
    });

    it('applies a guarded line replacement at the expected generation', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      const current = (await repo.findById(input.id))!.lockVersion;

      const saved = await repo.replaceLines(input.id, [newLine()], NOW, current);
      expect(saved?.lines).toHaveLength(1);
    });

    it('refuses a guarded line replacement at a stale generation, and writes nothing', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine(), newLine({ lineNumber: 2 })], NOW);
      const stale = (await repo.findById(input.id))!.lockVersion;

      await repo.replaceLines(input.id, [newLine({ quantityRolls: 7 })], LATER);
      const current = (await repo.findById(input.id))!.lockVersion;

      await expect(
        repo.replaceLines(input.id, [newLine({ quantityRolls: 9 })], LATER, stale),
      ).rejects.toBeInstanceOf(StaleAggregateError);

      const after = await repo.findWithLines(input.id);
      expect(after?.lines).toHaveLength(1);
      expect(after?.lines[0]?.quantityRolls).toBe(7);
      expect(after?.lockVersion).toBe(current);
    });

    it('returns null, not a conflict, for a guarded replacement on an unknown quote', async () => {
      const repo = await makeRepo();
      expect(await repo.replaceLines(newId(), [newLine()], NOW, 1)).toBeNull();
    });

    it('mints a revision at generation 1, and moves the original past it', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine()], NOW);
      await repo.transition(input.id, 'quoted', NOW);
      const originalBefore = (await repo.findById(input.id))!.lockVersion;

      const revised = await repo.revise(
        input.id,
        {
          ...newQuote(),
          id: newId(),
          customerId: input.customerId,
          rootQuoteId: input.rootQuoteId,
          versionNumber: input.versionNumber + 1,
          status: 'draft' as const,
          createdAt: LATER,
          updatedAt: LATER,
        },
        [newLine()],
        LATER,
      );

      expect(revised?.lockVersion).toBe(1);
      expect((await repo.findById(input.id))!.lockVersion).toBeGreaterThan(originalBefore);
    });

    it('still answers null for an unknown quote rather than raising staleness', async () => {
      const repo = await makeRepo();
      expect(
        await repo.recordOverrideDecision(
          newId(),
          null,
          {
            id: newId(),
            decision: 'rejected',
            kind: 'price',
            actor: 'x',
            reason: 'y',
            at: NOW.toISOString(),
          },
          NOW,
          1,
        ),
      ).toBeNull();
    });
  });

  describe('transition', () => {
    it('moves the quote and stamps updatedAt', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);

      const moved = await repo.transition(input.id, 'quoted', LATER);

      expect(moved).toMatchObject({ status: 'quoted', updatedAt: LATER.toISOString() });
    });

    it('leaves the lines alone', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine()], NOW);
      await repo.transition(input.id, 'quoted', LATER);

      const after = await repo.findWithLines(input.id);
      expect(after?.lines).toHaveLength(1);
      expect(after?.lines[0]?.pricePerRoll).toBe('13.3543');
    });

    it('returns null for an unknown id rather than throwing', async () => {
      const repo = await makeRepo();
      expect(await repo.transition(newId(), 'quoted', NOW)).toBeNull();
    });

    it('leaves fields other than status alone', async () => {
      const repo = await makeRepo();
      const input = newQuote({ salesRep: 'jsmith', notes: 'rush job' });
      await repo.create(input);

      const moved = await repo.transition(input.id, 'override_requested', LATER);
      expect(moved).toMatchObject({ salesRep: 'jsmith', notes: 'rush job' });
    });

    it('applies a guarded move at the expected generation', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine()], NOW);

      const current = (await repo.findById(input.id))!.lockVersion;
      const moved = await repo.transition(input.id, 'override_requested', LATER, current);

      expect(moved).toMatchObject({ status: 'override_requested' });
    });

    it('refuses a guarded move at a stale generation, and moves nothing', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      const stale = (await repo.findById(input.id))!.lockVersion;

      await repo.replaceLines(input.id, [newLine()], LATER);
      const current = (await repo.findById(input.id))!.lockVersion;

      await expect(repo.transition(input.id, 'closed_lost', LATER, stale)).rejects.toBeInstanceOf(
        StaleAggregateError,
      );

      const after = await repo.findById(input.id);
      expect(after?.status).toBe('draft');
      expect(after?.lockVersion).toBe(current);
    });

    it('returns null, not a conflict, for a guarded move on an unknown quote', async () => {
      const repo = await makeRepo();
      expect(await repo.transition(newId(), 'quoted', NOW, 1)).toBeNull();
    });

    it('appends its request rows with the move, touching neither pair', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      const current = (await repo.findById(input.id))!.lockVersion;
      const asked = (kind: 'price' | 'floor') => ({
        id: newId(),
        decision: 'requested' as const,
        kind,
        actor: 'dev-sales',
        at: LATER.toISOString(),
      });

      const moved = await repo.transition(input.id, 'override_requested', LATER, current, [
        asked('price'),
        asked('floor'),
      ]);

      expect(moved?.status).toBe('override_requested');
      expect(moved?.overrideApprovedBy).toBeUndefined();
      expect(moved?.floorOverrideBy).toBeUndefined();
      const log = await repo.overrideDecisions(input.id);
      expect(log.map((d) => `${d.decision}:${d.kind}:${d.actor}`).sort()).toEqual([
        'requested:floor:dev-sales',
        'requested:price:dev-sales',
      ]);
    });

    it('writes no request row when the guarded move is refused', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      const stale = (await repo.findById(input.id))!.lockVersion;
      await repo.replaceLines(input.id, [newLine()], LATER);

      await expect(
        repo.transition(input.id, 'override_requested', LATER, stale, [
          {
            id: newId(),
            decision: 'requested',
            kind: 'price',
            actor: 'dev-sales',
            at: LATER.toISOString(),
          },
        ]),
      ).rejects.toBeInstanceOf(StaleAggregateError);

      expect((await repo.findById(input.id))?.status).toBe('draft');
      expect(await repo.overrideDecisions(input.id)).toEqual([]);
    });
  });

  describe('a revision and the override pairs', () => {
    it('copies neither the price approval nor the floor override', async () => {
      const repo = await makeRepo();
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine()], NOW);
      for (const kind of ['price', 'floor'] as const) {
        await repo.recordOverrideDecision(
          input.id,
          { by: kind === 'price' ? 'bmanager' : 'dev-admin', at: NOW },
          {
            id: newId(),
            decision: 'approved',
            kind,
            actor: 'x',
            reason: 'y',
            at: NOW.toISOString(),
          },
          NOW,
        );
      }
      await repo.transition(input.id, 'quoted', NOW);

      const revised = await repo.revise(
        input.id,
        newQuote({
          id: newId(),
          customerId: input.customerId,
          rootQuoteId: input.rootQuoteId,
          versionNumber: 2,
          createdAt: LATER,
          updatedAt: LATER,
        }),
        [newLine()],
        LATER,
      );

      expect(revised?.overrideApprovedBy).toBeUndefined();
      expect(revised?.floorOverrideBy).toBeUndefined();
      expect(revised?.floorOverrideAt).toBeUndefined();

      const original = await repo.findById(input.id);
      expect(original?.overrideApprovedBy).toBe('bmanager');
      expect(original?.floorOverrideBy).toBe('dev-admin');
    });
  });

  // A line edit revokes the live decisions in the write that saves the lines:
  // docs/product/requirements.md (R6), docs/product/requirements.md (R7) and
  // docs/decisions/006-optimistic-concurrency.md.
  describe('a line replacement and the live decisions', () => {
    const DECIDED = new Date('2026-08-07T11:40:00.000Z');
    const EDITED = new Date('2026-08-07T12:25:00.000Z');
    const PRICE_REASON = 'quote lines were changed after approval';
    const FLOOR_REASON = 'quote lines were changed after the floor was overridden';

    const revocations = () => ({
      price: { id: newId(), actor: 'system:edit', reason: PRICE_REASON, at: EDITED.toISOString() },
      floor: { id: newId(), actor: 'system:edit', reason: FLOOR_REASON, at: EDITED.toISOString() },
    });

    // A quote with one line, in `status`, carrying a live decision of each kind in `kinds`.
    const decided = async (
      repo: QuoteRepository,
      kinds: readonly ('price' | 'floor')[],
      status: 'draft' | 'override_requested',
    ) => {
      const input = newQuote();
      await repo.create(input);
      await repo.replaceLines(input.id, [newLine({ quantityRolls: 410 })], NOW);
      if (status === 'override_requested') {
        await repo.transition(input.id, 'override_requested', NOW);
      }
      const approvedIds: Record<string, string> = {};
      for (const kind of kinds) {
        const id = newId();
        approvedIds[kind] = id;
        await repo.recordOverrideDecision(
          input.id,
          { by: kind === 'price' ? 'dev-billing' : 'dev-admin', at: DECIDED },
          { id, decision: 'approved', kind, actor: 'x', at: DECIDED.toISOString() },
          DECIDED,
        );
      }
      return { id: input.id, approvedIds, before: (await repo.findWithLines(input.id))! };
    };

    const revokedEntries = async (repo: QuoteRepository, quoteId: string) =>
      (await repo.overrideDecisions(quoteId))
        .filter((d) => d.decision === 'revoked')
        .map(({ kind, actor, reason, at }) => ({ kind, actor, reason, at }))
        .sort((a, b) => a.kind.localeCompare(b.kind));

    it('clears a live price approval, logs it and returns a queued quote to draft, in one call', async () => {
      const repo = await makeRepo();
      const { id, before } = await decided(repo, ['price'], 'override_requested');

      const saved = await repo.replaceLines(
        id,
        [newLine({ quantityRolls: 655 })],
        EDITED,
        before.lockVersion,
        undefined,
        revocations(),
      );

      expect(saved?.lines.map((l) => l.quantityRolls)).toEqual([655]);
      expect(saved?.overrideApprovedBy).toBeUndefined();
      expect(saved?.overrideApprovedAt).toBeUndefined();
      expect(saved?.status).toBe('draft');
      expect(saved?.lockVersion).toBe(before.lockVersion + 1);
      expect(await repo.findWithLines(id)).toEqual(saved);
      expect(await revokedEntries(repo, id)).toEqual([
        { kind: 'price', actor: 'system:edit', reason: PRICE_REASON, at: EDITED.toISOString() },
      ]);
    });

    it('clears a live floor override, logs it and returns a queued quote to draft, in one call', async () => {
      const repo = await makeRepo();
      const { id, before } = await decided(repo, ['floor'], 'override_requested');

      const saved = await repo.replaceLines(
        id,
        [newLine({ quantityRolls: 655 })],
        EDITED,
        before.lockVersion,
        undefined,
        revocations(),
      );

      expect(saved?.floorOverrideBy).toBeUndefined();
      expect(saved?.floorOverrideAt).toBeUndefined();
      expect(saved?.status).toBe('draft');
      expect(saved?.lockVersion).toBe(before.lockVersion + 1);
      expect(await repo.findWithLines(id)).toEqual(saved);
      expect(await revokedEntries(repo, id)).toEqual([
        { kind: 'floor', actor: 'system:edit', reason: FLOOR_REASON, at: EDITED.toISOString() },
      ]);
    });

    it('clears both live decisions on a draft, one log entry each, and keeps it a draft', async () => {
      const repo = await makeRepo();
      const { id, before } = await decided(repo, ['price', 'floor'], 'draft');

      const saved = await repo.replaceLines(
        id,
        [newLine({ quantityRolls: 655 }), newLine({ lineNumber: 2, quantityRolls: 38 })],
        EDITED,
        before.lockVersion,
        undefined,
        revocations(),
      );

      expect(saved?.lines.map((l) => l.quantityRolls)).toEqual([655, 38]);
      expect(saved?.overrideApprovedBy).toBeUndefined();
      expect(saved?.floorOverrideBy).toBeUndefined();
      expect(saved?.status).toBe('draft');
      expect(saved?.lockVersion).toBe(before.lockVersion + 1);
      expect(await revokedEntries(repo, id)).toEqual([
        { kind: 'floor', actor: 'system:edit', reason: FLOOR_REASON, at: EDITED.toISOString() },
        { kind: 'price', actor: 'system:edit', reason: PRICE_REASON, at: EDITED.toISOString() },
      ]);
    });

    it('logs nothing and keeps a queued quote queued when no decision is live', async () => {
      const repo = await makeRepo();
      const { id, before } = await decided(repo, [], 'override_requested');

      const saved = await repo.replaceLines(
        id,
        [newLine({ quantityRolls: 655 })],
        EDITED,
        before.lockVersion,
        undefined,
        revocations(),
      );

      expect(saved?.status).toBe('override_requested');
      expect(await repo.overrideDecisions(id)).toEqual([]);
    });

    it('saves nothing when a revocation cannot be logged', async () => {
      const repo = await makeRepo();
      const { id, approvedIds, before } = await decided(
        repo,
        ['price', 'floor'],
        'override_requested',
      );
      const logBefore = await repo.overrideDecisions(id);
      // The floor entry reuses the id of a logged decision, so its insert fails while every other
      // part of the call is valid.
      const clashing = revocations();
      clashing.floor.id = approvedIds.price!;

      await expect(
        repo.replaceLines(
          id,
          [newLine({ quantityRolls: 655 })],
          EDITED,
          before.lockVersion,
          undefined,
          clashing,
        ),
      ).rejects.toThrow();

      expect(await repo.findWithLines(id)).toEqual(before);
      expect(await repo.overrideDecisions(id)).toEqual(logBefore);
    });

    it('refuses to clear a live decision without its log entry, and saves nothing', async () => {
      const repo = await makeRepo();
      const { id, before } = await decided(repo, ['price'], 'override_requested');

      await expect(
        repo.replaceLines(id, [newLine({ quantityRolls: 655 })], EDITED, before.lockVersion),
      ).rejects.toBeInstanceOf(LineEditRevocationMissingError);

      expect(await repo.findWithLines(id)).toEqual(before);
      expect(await revokedEntries(repo, id)).toEqual([]);
    });

    it.each(['quoted', 'closed_lost'] as const)(
      'refuses to replace the lines of a quote in %s, at its current version, and saves nothing',
      async (status) => {
        const repo = await makeRepo();
        const { id } = await decided(repo, ['price'], 'draft');
        await repo.transition(id, status, DECIDED);
        const before = (await repo.findWithLines(id))!;

        await expect(
          repo.replaceLines(
            id,
            [newLine({ quantityRolls: 655 })],
            EDITED,
            before.lockVersion,
            undefined,
            revocations(),
          ),
        ).rejects.toBeInstanceOf(QuoteNotEditableError);
        await expect(
          repo.replaceLines(
            id,
            [newLine({ quantityRolls: 655 })],
            EDITED,
            undefined,
            undefined,
            revocations(),
          ),
        ).rejects.toBeInstanceOf(QuoteNotEditableError);

        expect(await repo.findWithLines(id)).toEqual(before);
        expect(await revokedEntries(repo, id)).toEqual([]);
      },
    );

    it('revokes nothing when the guarded save is stale', async () => {
      const repo = await makeRepo();
      const { id, before } = await decided(repo, ['price'], 'override_requested');

      await expect(
        repo.replaceLines(
          id,
          [newLine({ quantityRolls: 655 })],
          EDITED,
          before.lockVersion - 1,
          undefined,
          revocations(),
        ),
      ).rejects.toBeInstanceOf(StaleAggregateError);

      expect(await repo.findWithLines(id)).toEqual(before);
      expect(await revokedEntries(repo, id)).toEqual([]);
    });
  });
}
