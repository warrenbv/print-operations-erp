// PostgreSQL `CustomerDefaultsRepository` over crm.customer_defaults and crm.customer_parts.
// The parts are children of the defaults row and share its lockVersion:
// docs/decisions/006-optimistic-concurrency.md.
import { StaleAggregateError, isForeignKeyViolation, newId } from '@erp/db';
import {
  type CustomerDefaults,
  type PricingBasis,
  type ShippingMode,
  type StoredCustomerPart,
} from '@erp/types';
import { and, asc, eq, sql } from 'drizzle-orm';

import type { CrmDb } from '../../data/crm-db';
import { customerDefaults, customerParts } from '../../data/schema';
import {
  CustomerDefaultsCustomerNotFoundError,
  type AgreedPriceWrite,
  type CustomerDefaultsRepository,
  type CustomerDefaultsWrite,
} from '../../ports';

type DefaultsRow = typeof customerDefaults.$inferSelect;
type PartRow = typeof customerParts.$inferSelect;

function toDefaults(row: DefaultsRow, parts: readonly PartRow[]): CustomerDefaults {
  return {
    customerId: row.customerId,
    ...(row.pricingBasis === null ? {} : { pricingBasis: row.pricingBasis as PricingBasis }),
    ...(row.tierCode === null ? {} : { tierCode: row.tierCode }),
    ...(row.freightMode === null ? {} : { freightMode: row.freightMode as ShippingMode }),
    ...(row.leadTimeDays === null ? {} : { leadTimeDays: row.leadTimeDays }),
    parts: parts.map(toPart),
    lockVersion: row.lockVersion,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPart(row: PartRow): StoredCustomerPart {
  return {
    gradeId: row.gradeId,
    rollWidthIn: row.rollWidthIn,
    ...(row.partNumber === null ? {} : { partNumber: row.partNumber }),
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.feetPerRoll === null ? {} : { feetPerRoll: row.feetPerRoll }),

    ...(row.agreedPriceBasis === null ||
    row.agreedPrice === null ||
    row.agreedPriceSetBy === null ||
    row.agreedPriceSetAt === null
      ? {}
      : {
          agreedPrice: {
            basis: row.agreedPriceBasis as PricingBasis,
            price: row.agreedPrice,
            setBy: row.agreedPriceSetBy,
            setAt: row.agreedPriceSetAt.toISOString(),
          },
        }),
  };
}

// Grade ids compare case-insensitively, as `partFor` in packages/types/src/customer-defaults.ts does.
function partKey(gradeId: string, rollWidthIn: number): string {
  return `${gradeId.toLowerCase()}|${String(rollWidthIn)}`;
}

type AgreedColumns = Pick<
  PartRow,
  'agreedPriceBasis' | 'agreedPrice' | 'agreedPriceSetBy' | 'agreedPriceSetAt'
>;

// Thrown inside the transaction so the version bump rolls back when the part is gone by the time
// it is updated. Caught below and answered as 'no-part'.
class NoSuchPart extends Error {}

export class DrizzleCustomerDefaultsRepository implements CustomerDefaultsRepository {
  readonly #db: CrmDb;

  constructor(db: CrmDb) {
    this.#db = db;
  }

  async findByCustomer(customerId: string): Promise<CustomerDefaults | null> {
    const [row] = await this.#db
      .select()
      .from(customerDefaults)
      .where(eq(customerDefaults.customerId, customerId))
      .limit(1);
    if (row === undefined) {
      return null;
    }
    const parts = await this.#db
      .select()
      .from(customerParts)
      .where(eq(customerParts.customerId, customerId))

      .orderBy(asc(customerParts.position));
    return toDefaults(row, parts);
  }

  async replace(
    input: CustomerDefaultsWrite,
    expectedLockVersion: number,
  ): Promise<CustomerDefaults> {
    const values = {
      pricingBasis: input.pricingBasis ?? null,
      tierCode: input.tierCode ?? null,
      freightMode: input.freightMode ?? null,
      leadTimeDays: input.leadTimeDays ?? null,
      updatedBy: input.updatedBy,
      updatedAt: input.updatedAt,
    };
    try {
      return await this.#db.transaction(async (tx) => {
        let row: DefaultsRow | undefined;
        // Version 0 means no row yet. If a concurrent first save got there first, the insert returns
        // nothing and is reported as stale like any other lost race.
        if (expectedLockVersion === 0) {
          [row] = await tx
            .insert(customerDefaults)
            .values({ customerId: input.customerId, ...values, lockVersion: 1 })
            .onConflictDoNothing()
            .returning();
        } else {
          [row] = await tx
            .update(customerDefaults)
            .set({ ...values, lockVersion: sql`${customerDefaults.lockVersion} + 1` })
            .where(
              and(
                eq(customerDefaults.customerId, input.customerId),
                eq(customerDefaults.lockVersion, expectedLockVersion),
              ),
            )
            .returning();
        }
        if (row === undefined) {
          const [current] = await tx
            .select({ lockVersion: customerDefaults.lockVersion })
            .from(customerDefaults)
            .where(eq(customerDefaults.customerId, input.customerId))
            .limit(1);
          throw new StaleAggregateError(
            'customer-defaults',
            input.customerId,
            expectedLockVersion,
            current?.lockVersion ?? 0,
          );
        }

        // The parts are replaced wholesale, so agreed prices are read first and re-attached to every
        // part whose grade and width survive.
        const agreed = new Map<string, AgreedColumns>();
        for (const stored of await tx
          .select()
          .from(customerParts)
          .where(eq(customerParts.customerId, input.customerId))) {
          if (stored.agreedPrice !== null) {
            agreed.set(partKey(stored.gradeId, stored.rollWidthIn), {
              agreedPriceBasis: stored.agreedPriceBasis,
              agreedPrice: stored.agreedPrice,
              agreedPriceSetBy: stored.agreedPriceSetBy,
              agreedPriceSetAt: stored.agreedPriceSetAt,
            });
          }
        }

        await tx.delete(customerParts).where(eq(customerParts.customerId, input.customerId));
        let parts: PartRow[] = [];
        if (input.parts.length > 0) {
          parts = await tx
            .insert(customerParts)
            .values(
              input.parts.map((part, position) => ({
                id: newId(),
                customerId: input.customerId,
                position,
                gradeId: part.gradeId,
                rollWidthIn: part.rollWidthIn,
                partNumber: part.partNumber ?? null,
                description: part.description ?? null,
                feetPerRoll: part.feetPerRoll ?? null,
                ...agreed.get(partKey(part.gradeId, part.rollWidthIn)),
              })),
            )
            .returning();
          parts.sort((a, b) => a.position - b.position);
        }
        return toDefaults(row, parts);
      });
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        throw new CustomerDefaultsCustomerNotFoundError(input.customerId);
      }
      throw err;
    }
  }

  async setAgreedPrice(
    input: AgreedPriceWrite,
    expectedLockVersion: number,
  ): Promise<CustomerDefaults | 'no-part'> {
    const thePart = and(
      eq(customerParts.customerId, input.customerId),
      eq(customerParts.gradeId, input.gradeId),
      eq(customerParts.rollWidthIn, input.rollWidthIn),
    );

    const [existing] = await this.#db
      .select({ id: customerParts.id })
      .from(customerParts)
      .where(thePart)
      .limit(1);
    if (existing === undefined) {
      return 'no-part';
    }
    try {
      return await this.#db.transaction(async (tx) => {
        // Only a part changes, but the parent's lockVersion moves, because child writes count.
        const [row] = await tx
          .update(customerDefaults)
          .set({ lockVersion: sql`${customerDefaults.lockVersion} + 1` })
          .where(
            and(
              eq(customerDefaults.customerId, input.customerId),
              eq(customerDefaults.lockVersion, expectedLockVersion),
            ),
          )
          .returning();
        if (row === undefined) {
          const [current] = await tx
            .select({ lockVersion: customerDefaults.lockVersion })
            .from(customerDefaults)
            .where(eq(customerDefaults.customerId, input.customerId))
            .limit(1);
          throw new StaleAggregateError(
            'customer-defaults',
            input.customerId,
            expectedLockVersion,
            current?.lockVersion ?? 0,
          );
        }
        const updated = await tx
          .update(customerParts)
          .set({
            agreedPriceBasis: input.agreed?.basis ?? null,
            agreedPrice: input.agreed?.price ?? null,
            agreedPriceSetBy: input.agreed?.setBy ?? null,
            agreedPriceSetAt: input.agreed?.setAt ?? null,
          })
          .where(thePart)
          .returning({ id: customerParts.id });
        if (updated.length === 0) {
          throw new NoSuchPart();
        }
        const parts = await tx
          .select()
          .from(customerParts)
          .where(eq(customerParts.customerId, input.customerId))
          .orderBy(asc(customerParts.position));
        return toDefaults(row, parts);
      });
    } catch (err) {
      if (err instanceof NoSuchPart) {
        return 'no-part';
      }
      throw err;
    }
  }
}
