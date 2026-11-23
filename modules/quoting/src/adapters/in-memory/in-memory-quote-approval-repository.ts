// The in-memory adapter for `QuoteApprovalRepository`, the credit-hold exceptions of
// docs/product/requirements.md (R2). Contract:
// modules/quoting/test/contracts/quote-approval-repository.contract.ts.
import type { QuoteApproval } from '@erp/types';

import {
  QuoteApprovalAlreadyDecidedError,
  UnspentQuoteApprovalExistsError,
  type NewQuoteApproval,
  type QuoteApprovalDecision,
  type QuoteApprovalRepository,
} from '../../ports';

export class InMemoryQuoteApprovalRepository implements QuoteApprovalRepository {
  readonly #rows = new Map<string, QuoteApproval>();

  #unspentFor(customerId: string): QuoteApproval | undefined {
    for (const row of this.#rows.values()) {
      if (
        row.customerId === customerId &&
        row.status === 'approved' &&
        row.spentByQuoteId === undefined
      ) {
        return row;
      }
    }
    return undefined;
  }

  async request(input: NewQuoteApproval): Promise<QuoteApproval> {
    const row: QuoteApproval = {
      id: input.id,
      customerId: input.customerId,
      status: 'pending',
      reason: input.reason,
      requestedBy: input.requestedBy,
      requestedAt: input.requestedAt.toISOString(),
    };
    this.#rows.set(row.id, row);
    return row;
  }

  async findById(id: string): Promise<QuoteApproval | null> {
    return this.#rows.get(id) ?? null;
  }

  async decide(id: string, decision: QuoteApprovalDecision): Promise<QuoteApproval | null> {
    const existing = this.#rows.get(id);
    if (existing === undefined) {
      return null;
    }
    if (existing.status !== 'pending') {
      throw new QuoteApprovalAlreadyDecidedError(id, existing.status);
    }
    // Stands in for the partial unique index that allows one unspent exception per customer.
    if (decision.decision === 'approved' && this.#unspentFor(existing.customerId) !== undefined) {
      throw new UnspentQuoteApprovalExistsError(existing.customerId);
    }

    const decided: QuoteApproval = {
      ...existing,
      status: decision.decision,
      decidedBy: decision.decidedBy,
      decidedAt: decision.decidedAt.toISOString(),

      ...(decision.decision === 'rejected' && decision.reason !== undefined
        ? { decisionReason: decision.reason }
        : {}),
    };
    this.#rows.set(id, decided);
    return decided;
  }

  async listPending(): Promise<readonly QuoteApproval[]> {
    return [...this.#rows.values()]
      .filter((row) => row.status === 'pending')
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  async listForCustomer(customerId: string): Promise<readonly QuoteApproval[]> {
    return [...this.#rows.values()]
      .filter((row) => row.customerId === customerId)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || b.id.localeCompare(a.id));
  }

  async findUnspentFor(customerId: string): Promise<QuoteApproval | null> {
    return this.#unspentFor(customerId) ?? null;
  }

  // Not part of the port. InMemoryQuoteRepository calls it when it creates a quote for a held
  // customer, in place of the Drizzle adapter's transaction.
  spend(customerId: string, quoteId: string, at: Date): QuoteApproval | null {
    const unspent = this.#unspentFor(customerId);
    if (unspent === undefined) {
      return null;
    }
    const spent: QuoteApproval = {
      ...unspent,
      spentByQuoteId: quoteId,
      spentAt: at.toISOString(),
    };
    this.#rows.set(spent.id, spent);
    return spent;
  }
}
