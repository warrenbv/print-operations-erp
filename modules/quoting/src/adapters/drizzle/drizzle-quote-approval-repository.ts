// The PostgreSQL adapter for `QuoteApprovalRepository`, the credit-hold exceptions of
// docs/product/requirements.md (R2). An exception is spent by
// modules/quoting/src/adapters/drizzle/drizzle-quote-repository.ts when it creates the quote.
// Contract: modules/quoting/test/contracts/quote-approval-repository.contract.ts.
import { isUniqueViolation } from '@erp/db';
import type { QuoteApproval, QuoteApprovalStatus } from '@erp/types';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import type { QuotingDb } from '../../data/quoting-db';
import { quoteApprovals } from '../../data/schema';
import {
  QuoteApprovalAlreadyDecidedError,
  UnspentQuoteApprovalExistsError,
  type NewQuoteApproval,
  type QuoteApprovalDecision,
  type QuoteApprovalRepository,
} from '../../ports';

type Row = typeof quoteApprovals.$inferSelect;

export function toQuoteApproval(row: Row): QuoteApproval {
  return {
    id: row.id,
    customerId: row.customerId,

    status: row.status as QuoteApprovalStatus,
    reason: row.reason,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    ...(row.decidedBy === null ? {} : { decidedBy: row.decidedBy }),
    ...(row.decidedAt === null ? {} : { decidedAt: row.decidedAt.toISOString() }),
    ...(row.decisionReason === null ? {} : { decisionReason: row.decisionReason }),
    ...(row.spentByQuoteId === null ? {} : { spentByQuoteId: row.spentByQuoteId }),
    ...(row.spentAt === null ? {} : { spentAt: row.spentAt.toISOString() }),
  };
}

export class DrizzleQuoteApprovalRepository implements QuoteApprovalRepository {
  readonly #db: QuotingDb;

  constructor(db: QuotingDb) {
    this.#db = db;
  }

  async request(input: NewQuoteApproval): Promise<QuoteApproval> {
    const [row] = await this.#db
      .insert(quoteApprovals)
      .values({
        id: input.id,
        customerId: input.customerId,
        status: 'pending',
        reason: input.reason,
        requestedBy: input.requestedBy,
        requestedAt: input.requestedAt,
      })
      .returning();
    if (row === undefined) {
      throw new Error('insert returned no row');
    }
    return toQuoteApproval(row);
  }

  async findById(id: string): Promise<QuoteApproval | null> {
    const [row] = await this.#db
      .select()
      .from(quoteApprovals)
      .where(eq(quoteApprovals.id, id))
      .limit(1);
    return row === undefined ? null : toQuoteApproval(row);
  }

  async decide(id: string, decision: QuoteApprovalDecision): Promise<QuoteApproval | null> {
    const existing = await this.findById(id);
    if (existing === null) {
      return null;
    }
    if (existing.status !== 'pending') {
      throw new QuoteApprovalAlreadyDecidedError(id, existing.status);
    }

    try {
      const [row] = await this.#db
        .update(quoteApprovals)
        .set({
          status: decision.decision,
          decidedBy: decision.decidedBy,
          decidedAt: decision.decidedAt,
          decisionReason: decision.decision === 'rejected' ? (decision.reason ?? null) : null,
        })
        // The pending test is repeated in the WHERE clause, so two concurrent decisions cannot both
        // land.
        .where(and(eq(quoteApprovals.id, id), eq(quoteApprovals.status, 'pending')))
        .returning();
      if (row === undefined) {
        throw new QuoteApprovalAlreadyDecidedError(id, existing.status);
      }
      return toQuoteApproval(row);
    } catch (err) {
      // The only unique index this update can break is the one allowing a single unspent exception
      // per customer.
      if (isUniqueViolation(err)) {
        throw new UnspentQuoteApprovalExistsError(existing.customerId);
      }
      throw err;
    }
  }

  async listPending(): Promise<readonly QuoteApproval[]> {
    const rows = await this.#db
      .select()
      .from(quoteApprovals)
      .where(eq(quoteApprovals.status, 'pending'))

      .orderBy(asc(quoteApprovals.requestedAt));
    return rows.map(toQuoteApproval);
  }

  async listForCustomer(customerId: string): Promise<readonly QuoteApproval[]> {
    const rows = await this.#db
      .select()
      .from(quoteApprovals)
      .where(eq(quoteApprovals.customerId, customerId))

      .orderBy(desc(quoteApprovals.requestedAt), desc(quoteApprovals.id));
    return rows.map(toQuoteApproval);
  }

  async findUnspentFor(customerId: string): Promise<QuoteApproval | null> {
    const [row] = await this.#db
      .select()
      .from(quoteApprovals)
      .where(
        and(
          eq(quoteApprovals.customerId, customerId),
          eq(quoteApprovals.status, 'approved'),
          isNull(quoteApprovals.spentByQuoteId),
        ),
      )
      .limit(1);
    return row === undefined ? null : toQuoteApproval(row);
  }
}
