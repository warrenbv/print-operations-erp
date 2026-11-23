// What every CustomerDefaultsRepository adapter must do, written once and run against both adapters
// by modules/crm/test/customer-defaults-repository.contract.test.ts. It covers the first save at
// version 0, replacing parts while keeping agreed prices, and setting an agreed price.
// A failure in only one adapter means the two disagree, the defect this layer exists to catch:
// docs/process/verifying-agent-written-code.md.
import { StaleAggregateError } from '@erp/db';
import { describe, expect, it } from 'vitest';

import type { CustomerDefaultsRepository, CustomerDefaultsWrite } from '../../src/ports';

export function customerDefaultsRepositoryContract(
  makeRepo: () => Promise<{ defaults: CustomerDefaultsRepository; customerId: string }>,
): void {
  const KRAFT = '01988a00-0583-7000-8000-000000000001';
  const BUTCHER = '01988a00-0583-7000-8000-000000000002';
  const NOW = new Date('2026-09-28T09:00:00.000Z');
  const LATER = new Date('2026-09-28T09:05:00.000Z');

  function write(
    customerId: string,
    over: Partial<CustomerDefaultsWrite> = {},
  ): CustomerDefaultsWrite {
    return { customerId, parts: [], updatedBy: 'jsmith', updatedAt: NOW, ...over };
  }

  describe('findByCustomer', () => {
    it('answers null for an account nobody has set up', async () => {
      const { defaults, customerId } = await makeRepo();
      expect(await defaults.findByCustomer(customerId)).toBeNull();
    });
  });

  describe('replace', () => {
    it('creates the defaults on a first save at generation 0, and reads them back', async () => {
      const { defaults, customerId } = await makeRepo();

      const saved = await defaults.replace(
        write(customerId, {
          pricingBasis: 'per_pound',

          tierCode: 'list',
          freightMode: 'carrier',
          leadTimeDays: 0,
          parts: [
            {
              gradeId: KRAFT,
              rollWidthIn: 36,
              partNumber: 'LN-34',
              description: 'CEDAR CORE',

              feetPerRoll: '1480.0000',
            },
            { gradeId: BUTCHER, rollWidthIn: 18, description: 'BUTCHER 18' },
          ],
        }),
        0,
      );

      const expected = {
        customerId,
        pricingBasis: 'per_pound',
        tierCode: 'list',
        freightMode: 'carrier',

        leadTimeDays: 0,
        parts: [
          {
            gradeId: KRAFT,
            rollWidthIn: 36,
            partNumber: 'LN-34',
            description: 'CEDAR CORE',
            feetPerRoll: '1480.0000',
          },

          { gradeId: BUTCHER, rollWidthIn: 18, description: 'BUTCHER 18' },
        ],
        lockVersion: 1,
        updatedBy: 'jsmith',
        updatedAt: NOW.toISOString(),
      };
      expect(saved).toEqual(expected);
      expect(await defaults.findByCustomer(customerId)).toEqual(expected);
    });

    it('keeps the parts in the order they were posted', async () => {
      const { defaults, customerId } = await makeRepo();
      const widths = [48, 12, 36, 24, 60];
      await defaults.replace(
        write(customerId, {
          parts: widths.map((rollWidthIn) => ({
            gradeId: KRAFT,
            rollWidthIn,
            partNumber: `P${rollWidthIn}`,
          })),
        }),
        0,
      );
      const read = await defaults.findByCustomer(customerId);
      expect(read?.parts.map((part) => part.rollWidthIn)).toEqual(widths);
    });

    it('gives a width in sixteenths back as the number it went in as', async () => {
      const { defaults, customerId } = await makeRepo();
      await defaults.replace(
        write(customerId, {
          parts: [
            {
              gradeId: KRAFT,
              rollWidthIn: 9.75,
              partNumber: 'MW-20463',
              description: 'CEDAR CORE SHEET',
            },
            { gradeId: KRAFT, rollWidthIn: 11.3125, partNumber: 'MW-1175-A' },
            { gradeId: KRAFT, rollWidthIn: 12, partNumber: 'P12' },
          ],
        }),
        0,
      );
      const read = await defaults.findByCustomer(customerId);
      expect(read?.parts.map((part) => part.rollWidthIn)).toEqual([9.75, 11.3125, 12]);
    });

    it('gives a roll length back at four places, and clears one a later save leaves off', async () => {
      const { defaults, customerId } = await makeRepo();
      await defaults.replace(
        write(customerId, {
          parts: [
            { gradeId: KRAFT, rollWidthIn: 11.3125, partNumber: 'MW-1175-A', feetPerRoll: '1480' },
            { gradeId: KRAFT, rollWidthIn: 9.75, partNumber: 'MW-20463', feetPerRoll: '1260.5' },
          ],
        }),
        0,
      );
      const read = await defaults.findByCustomer(customerId);
      expect(read?.parts.map((part) => part.feetPerRoll)).toEqual(['1480.0000', '1260.5000']);

      await defaults.replace(
        write(customerId, {
          parts: [
            { gradeId: KRAFT, rollWidthIn: 11.3125, partNumber: 'MW-1175-A' },
            { gradeId: KRAFT, rollWidthIn: 9.75, partNumber: 'MW-20463', feetPerRoll: '1260.5' },
          ],
        }),
        1,
      );
      const cleared = await defaults.findByCustomer(customerId);
      expect(cleared?.parts[0]).toEqual({
        gradeId: KRAFT,
        rollWidthIn: 11.3125,
        partNumber: 'MW-1175-A',
      });
      expect(cleared?.parts[1]?.feetPerRoll).toBe('1260.5000');
    });

    it('replaces the whole set: an absent field clears, a part left out is removed', async () => {
      const { defaults, customerId } = await makeRepo();
      await defaults.replace(
        write(customerId, {
          pricingBasis: 'per_pound',
          tierCode: 'volume_3',
          freightMode: 'carrier',
          leadTimeDays: 10,
          parts: [
            { gradeId: KRAFT, rollWidthIn: 36, partNumber: 'A' },
            { gradeId: KRAFT, rollWidthIn: 48, partNumber: 'B' },
          ],
        }),
        0,
      );

      const second = await defaults.replace(
        write(customerId, {
          freightMode: 'pickup',
          parts: [{ gradeId: KRAFT, rollWidthIn: 48, partNumber: 'B2' }],
          updatedBy: 'kjones',
          updatedAt: LATER,
        }),
        1,
      );

      expect(second).toEqual({
        customerId,
        freightMode: 'pickup',
        parts: [{ gradeId: KRAFT, rollWidthIn: 48, partNumber: 'B2' }],
        lockVersion: 2,
        updatedBy: 'kjones',
        updatedAt: LATER.toISOString(),
      });
      expect(await defaults.findByCustomer(customerId)).toEqual(second);
    });

    it('moves the generation on a save that changes nothing, because it restamps who saved', async () => {
      const { defaults, customerId } = await makeRepo();
      await defaults.replace(write(customerId), 0);
      const again = await defaults.replace(write(customerId, { updatedAt: LATER }), 1);
      expect(again.lockVersion).toBe(2);
    });

    it('refuses a first save when somebody else saved first, and keeps theirs', async () => {
      const { defaults, customerId } = await makeRepo();
      await defaults.replace(write(customerId, { freightMode: 'carrier' }), 0);

      const refused = defaults.replace(write(customerId, { freightMode: 'pickup' }), 0);
      await expect(refused).rejects.toBeInstanceOf(StaleAggregateError);
      await expect(refused).rejects.toMatchObject({ expected: 0, actual: 1 });
      expect((await defaults.findByCustomer(customerId))?.freightMode).toBe('carrier');
    });

    it('refuses a stale generation and leaves the parts alone', async () => {
      const { defaults, customerId } = await makeRepo();
      await defaults.replace(
        write(customerId, { parts: [{ gradeId: KRAFT, rollWidthIn: 36, partNumber: 'A' }] }),
        0,
      );
      await defaults.replace(
        write(customerId, { parts: [{ gradeId: KRAFT, rollWidthIn: 36, partNumber: 'B' }] }),
        1,
      );

      const refused = defaults.replace(write(customerId, { parts: [] }), 1);
      await expect(refused).rejects.toMatchObject({ expected: 1, actual: 2 });
      expect((await defaults.findByCustomer(customerId))?.parts).toEqual([
        { gradeId: KRAFT, rollWidthIn: 36, partNumber: 'B' },
      ]);
    });

    it('refuses a later generation on an account with no defaults, as actual 0', async () => {
      const { defaults, customerId } = await makeRepo();
      await expect(defaults.replace(write(customerId), 3)).rejects.toMatchObject({
        expected: 3,
        actual: 0,
      });
      expect(await defaults.findByCustomer(customerId)).toBeNull();
    });
  });

  describe('setAgreedPrice', () => {
    const SET_AT = new Date('2026-11-16T17:00:00.000Z');
    const agreedPerPound = {
      basis: 'per_pound' as const,
      price: '0.69',
      setBy: 'dev-billing',
      setAt: SET_AT,
    };
    const stored = {
      basis: 'per_pound',
      price: '0.6900',
      setBy: 'dev-billing',
      setAt: SET_AT.toISOString(),
    };

    async function withParts(defaults: CustomerDefaultsRepository, customerId: string) {
      await defaults.replace(
        write(customerId, {
          parts: [
            { gradeId: KRAFT, rollWidthIn: 12, partNumber: 'TEST-12' },
            { gradeId: KRAFT, rollWidthIn: 9.75, partNumber: 'TEST-9Q' },
          ],
        }),
        0,
      );
    }

    it('sets it on the part with that paper and width, at four places, and moves the generation', async () => {
      const { defaults, customerId } = await makeRepo();
      await withParts(defaults, customerId);

      const set = await defaults.setAgreedPrice(
        { customerId, gradeId: KRAFT, rollWidthIn: 9.75, agreed: agreedPerPound },
        1,
      );

      expect(set).not.toBe('no-part');
      const read = await defaults.findByCustomer(customerId);
      expect(read?.parts[1]?.agreedPrice).toEqual(stored);
      expect(read?.parts[0]?.agreedPrice).toBeUndefined();
      expect(read?.lockVersion).toBe(2);

      expect(read?.updatedBy).toBe('jsmith');
      expect(read?.updatedAt).toBe(NOW.toISOString());
      expect(set).toEqual(read);
    });

    it('removes it with null, leaving the part', async () => {
      const { defaults, customerId } = await makeRepo();
      await withParts(defaults, customerId);
      await defaults.setAgreedPrice(
        { customerId, gradeId: KRAFT, rollWidthIn: 12, agreed: agreedPerPound },
        1,
      );

      await defaults.setAgreedPrice(
        { customerId, gradeId: KRAFT, rollWidthIn: 12, agreed: null },
        2,
      );

      const read = await defaults.findByCustomer(customerId);
      expect(read?.parts[0]).toEqual({ gradeId: KRAFT, rollWidthIn: 12, partNumber: 'TEST-12' });
      expect(read?.lockVersion).toBe(3);
    });

    it('answers no-part for a paper and width the account has no part on, or no defaults at all', async () => {
      const { defaults, customerId } = await makeRepo();
      expect(
        await defaults.setAgreedPrice(
          { customerId, gradeId: KRAFT, rollWidthIn: 12, agreed: agreedPerPound },
          0,
        ),
      ).toBe('no-part');

      await withParts(defaults, customerId);
      expect(
        await defaults.setAgreedPrice(
          { customerId, gradeId: BUTCHER, rollWidthIn: 12, agreed: agreedPerPound },
          1,
        ),
      ).toBe('no-part');

      expect((await defaults.findByCustomer(customerId))?.lockVersion).toBe(1);
    });

    it('refuses a stale generation and sets nothing', async () => {
      const { defaults, customerId } = await makeRepo();
      await withParts(defaults, customerId);

      const refused = defaults.setAgreedPrice(
        { customerId, gradeId: KRAFT, rollWidthIn: 12, agreed: agreedPerPound },
        0,
      );
      await expect(refused).rejects.toBeInstanceOf(StaleAggregateError);
      await expect(refused).rejects.toMatchObject({ expected: 0, actual: 1 });
      expect((await defaults.findByCustomer(customerId))?.parts[0]?.agreedPrice).toBeUndefined();
    });

    it('is kept by any later save of the form while the paper and width are unchanged', async () => {
      const { defaults, customerId } = await makeRepo();
      await withParts(defaults, customerId);
      await defaults.setAgreedPrice(
        { customerId, gradeId: KRAFT, rollWidthIn: 12, agreed: agreedPerPound },
        1,
      );

      const saved = await defaults.replace(
        write(customerId, {
          parts: [
            { gradeId: KRAFT, rollWidthIn: 9.75, partNumber: 'TEST-9Q' },
            { gradeId: KRAFT, rollWidthIn: 12, partNumber: 'TEST-12-B', feetPerRoll: '900' },
          ],
          updatedBy: 'kjones',
          updatedAt: LATER,
        }),
        2,
      );

      expect(saved.parts[1]?.agreedPrice).toEqual(stored);
      expect(saved.parts[0]?.agreedPrice).toBeUndefined();
      expect((await defaults.findByCustomer(customerId))?.parts[1]?.agreedPrice).toEqual(stored);
    });

    it('is lost by a part removed, or moved to another paper or width', async () => {
      const { defaults, customerId } = await makeRepo();
      await withParts(defaults, customerId);
      await defaults.setAgreedPrice(
        { customerId, gradeId: KRAFT, rollWidthIn: 12, agreed: agreedPerPound },
        1,
      );
      await defaults.setAgreedPrice(
        { customerId, gradeId: KRAFT, rollWidthIn: 9.75, agreed: agreedPerPound },
        2,
      );

      await defaults.replace(
        write(customerId, {
          parts: [
            { gradeId: KRAFT, rollWidthIn: 12.3125, partNumber: 'TEST-12' },
            { gradeId: BUTCHER, rollWidthIn: 9.75, partNumber: 'TEST-9Q' },
          ],
        }),
        3,
      );
      const moved = await defaults.findByCustomer(customerId);
      expect(moved?.parts.map((part) => part.agreedPrice)).toEqual([undefined, undefined]);

      await defaults.replace(
        write(customerId, { parts: [{ gradeId: KRAFT, rollWidthIn: 12, partNumber: 'TEST-12' }] }),
        4,
      );
      expect((await defaults.findByCustomer(customerId))?.parts[0]?.agreedPrice).toBeUndefined();
    });
  });
}
