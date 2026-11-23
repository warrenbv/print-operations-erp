// The in-memory adapter for `QuoteRepository`, used when the API runs on in-memory storage and by
// the unit tests. It must behave as the Drizzle adapter does, and both are held to
// modules/quoting/test/contracts/quote-repository.contract.ts. Every write bumps `lockVersion`:
// docs/decisions/006-optimistic-concurrency.md.
import type {
  CountAndOldest,
  Quote,
  QuoteLine,
  QuoteListItem,
  QuoteOverrideDecision,
  QuoteOverrideKind,
  QuoteSend,
  QuoteStatus,
  QuoteWithLines,
} from '@erp/types';

import {
  LineEditRevocationMissingError,
  QuoteNotEditableError,
  QuoteNotRevisableError,
  QuoteVersionConflictError,
  StaleAggregateError,
} from '../../ports';
import { canTransition, isEditable } from '../../quote-state-machine';
import type {
  LineEditRevocations,
  NewQuoteLine,
  NewQuoteRow,
  NewQuoteSend,
  QuoteHeaderPatch,
  QuoteListParams,
  QuoteRepository,
  SpentQuoteApproval,
} from '../../ports';
import type { InMemoryQuoteApprovalRepository } from './in-memory-quote-approval-repository';

function byUpdatedAtThenId(a: Quote, b: Quote): number {
  return codeUnitOrder(a.updatedAt, b.updatedAt) || codeUnitOrder(a.id, b.id);
}

function codeUnitOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function livePair(
  by: string | undefined,
  at: string | undefined,
): { by: string; at: string } | undefined {
  return by === undefined || at === undefined ? undefined : { by, at };
}

export class InMemoryQuoteRepository implements QuoteRepository {
  readonly #quotes = new Map<string, Quote>();
  readonly #lines = new Map<string, QuoteLine[]>();
  readonly #decisions = new Map<string, QuoteOverrideDecision[]>();

  readonly #sends = new Map<string, QuoteSend[]>();
  readonly #approvals: InMemoryQuoteApprovalRepository | undefined;

  #lastQuoteNumber = 0;

  constructor(approvals?: InMemoryQuoteApprovalRepository) {
    this.#approvals = approvals;
  }

  // Counts from 1 like the database sequence. A revision keeps its chain's number.
  #mintQuoteNumber(): number {
    this.#lastQuoteNumber += 1;
    return this.#lastQuoteNumber;
  }

  async create(input: NewQuoteRow): Promise<Quote> {
    const quote = this.#newQuote(input);
    this.#quotes.set(quote.id, quote);
    this.#lines.set(quote.id, []);
    return quote;
  }

  #newQuote(input: NewQuoteRow): Quote {
    return {
      id: input.id,
      customerId: input.customerId,
      status: input.status,
      rootQuoteId: input.rootQuoteId,
      versionNumber: input.versionNumber,
      quoteNumber: input.quoteNumber ?? this.#mintQuoteNumber(),

      lockVersion: 1,

      ...(input.salesRep === undefined ? {} : { salesRep: input.salesRep }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),

      freightInRollPrice: input.freightInRollPrice ?? false,
      createdAt: input.createdAt.toISOString(),
      updatedAt: input.updatedAt.toISOString(),
    };
  }

  async createSpendingApproval(input: NewQuoteRow): Promise<SpentQuoteApproval | null> {
    if (this.#approvals === undefined) {
      return null;
    }

    // The exception is spent and the quote stored with nothing awaited between them, so two creates
    // against one exception cannot both pass, as in the Drizzle adapter's transaction. A customer
    // with no unspent exception gets null and nothing is written.
    const approval = this.#approvals.spend(input.customerId, input.id, input.createdAt);
    if (approval === null) {
      return null;
    }
    const quote = this.#newQuote(input);
    this.#quotes.set(quote.id, quote);
    this.#lines.set(quote.id, []);
    return { quote, approval };
  }

  async findById(id: string): Promise<Quote | null> {
    return this.#quotes.get(id) ?? null;
  }

  async findWithLines(id: string): Promise<QuoteWithLines | null> {
    const quote = this.#quotes.get(id);
    if (quote === undefined) {
      return null;
    }
    const lines = this.#lines.get(id) ?? [];
    return {
      ...quote,
      lines: [...lines].sort((a, b) => a.lineNumber - b.lineNumber),
    };
  }

  async list(params: QuoteListParams): Promise<readonly QuoteListItem[]> {
    const listed = this.#filtered(params);

    if (params.sort === 'oldest') {
      listed.sort(byUpdatedAtThenId);
    } else if (params.sort === 'newest') {
      listed.sort((a, b) => byUpdatedAtThenId(b, a));
    }

    const cut = params.limit === undefined ? listed : listed.slice(0, params.limit);
    return cut.map((q) => ({ ...q, ...this.#lineSummary(q.id) }));
  }

  async countAndOldest(
    params: Omit<QuoteListParams, 'sort' | 'limit'>,
  ): Promise<CountAndOldest<Quote>> {
    const listed = this.#filtered(params).sort(byUpdatedAtThenId);
    const [oldest] = listed;
    return { count: listed.length, oldest: oldest === undefined ? null : { ...oldest } };
  }

  #filtered(params: QuoteListParams): Quote[] {
    return [...this.#quotes.values()]
      .filter((q) => params.status === undefined || q.status === params.status)

      .filter((q) => params.customerIds === undefined || params.customerIds.includes(q.customerId))

      .filter((q) => params.ids === undefined || params.ids.includes(q.id))
      .filter((q) => params.quoteNumber === undefined || q.quoteNumber === params.quoteNumber)

      .filter((q) => params.salesRep === undefined || q.salesRep === params.salesRep)

      .filter((q) => params.leadTime === undefined || q.leadTimeDays === undefined)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  #lineSummary(
    quoteId: string,
  ): Pick<QuoteListItem, 'lineCount' | 'belowFloorCount' | 'manualCount' | 'manualPricePerRoll'> {
    const lines = [...(this.#lines.get(quoteId) ?? [])].sort((a, b) => a.lineNumber - b.lineNumber);
    const manual = lines.filter((line) => line.priceSource === 'manual');
    return {
      lineCount: lines.length,
      belowFloorCount: lines.filter((line) => line.floor.status === 'below_floor').length,
      manualCount: manual.length,
      manualPricePerRoll: manual[0]?.pricePerRoll ?? null,
    };
  }

  async replaceLines(
    quoteId: string,
    lines: readonly NewQuoteLine[],
    updatedAt: Date,
    expectedLockVersion?: number,
    header: QuoteHeaderPatch = {},
    revocations?: LineEditRevocations,
  ): Promise<QuoteWithLines | null> {
    const quote = this.#quotes.get(quoteId);
    if (quote === undefined) {
      return null;
    }

    if (expectedLockVersion !== undefined && quote.lockVersion !== expectedLockVersion) {
      throw new StaleAggregateError('quote', quoteId, expectedLockVersion, quote.lockVersion);
    }
    if (!isEditable(quote.status)) {
      throw new QuoteNotEditableError(quoteId, quote.status);
    }

    // Every check runs before the first change, and nothing below awaits, so the lines, the
    // revocations and the return to draft land together or not at all: modules/quoting/src/ports.ts.
    const live: QuoteOverrideKind[] = [
      ...(quote.overrideApprovedBy === undefined ? [] : ['price' as const]),
      ...(quote.floorOverrideBy === undefined ? [] : ['floor' as const]),
    ];
    const entries: QuoteOverrideDecision[] = live.map((kind) => {
      const entry = revocations?.[kind];
      if (entry === undefined) {
        throw new LineEditRevocationMissingError(quoteId, kind);
      }
      return { ...entry, decision: 'revoked', kind, quoteId };
    });
    for (const entry of entries) {
      // Mirrors the primary key on quote_override_decisions in
      // infra/db/migrations/quoting/0000_baseline.sql.
      if (this.#decisionIdTaken(entry.id) || entries.filter((e) => e.id === entry.id).length > 1) {
        throw new Error(`override decision "${entry.id}" already exists`);
      }
    }

    const stamp = updatedAt.toISOString();
    const next: Quote = {
      ...quote,

      ...(header.freightInRollPrice === undefined
        ? {}
        : { freightInRollPrice: header.freightInRollPrice }),
      ...(entries.length > 0 && canTransition(quote.status, 'draft')
        ? { status: 'draft' as const }
        : {}),
      updatedAt: stamp,
      lockVersion: quote.lockVersion + 1,
    };
    if (live.includes('price')) {
      delete next.overrideApprovedBy;
      delete next.overrideApprovedAt;
    }
    if (live.includes('floor')) {
      delete next.floorOverrideBy;
      delete next.floorOverrideAt;
    }

    this.#lines.set(
      quoteId,
      lines.map((line) => ({ ...line, quoteId, createdAt: stamp, updatedAt: stamp })),
    );
    this.#quotes.set(quoteId, next);
    if (entries.length > 0) {
      this.#decisions.set(quoteId, [...(this.#decisions.get(quoteId) ?? []), ...entries]);
    }

    return this.findWithLines(quoteId);
  }

  #decisionIdTaken(id: string): boolean {
    for (const log of this.#decisions.values()) {
      if (log.some((entry) => entry.id === id)) return true;
    }
    return false;
  }

  async setLeadTime(
    quoteId: string,
    leadTimeDays: number,
    setBy: string,
    updatedAt: Date,
    expectedLockVersion: number,
  ): Promise<Quote | null> {
    const quote = this.#quotes.get(quoteId);
    if (quote === undefined) {
      return null;
    }

    if (quote.lockVersion !== expectedLockVersion) {
      throw new StaleAggregateError('quote', quoteId, expectedLockVersion, quote.lockVersion);
    }
    const updated: Quote = {
      ...quote,
      leadTimeDays,
      leadTimeSetBy: setBy,
      leadTimeSetAt: updatedAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      lockVersion: quote.lockVersion + 1,
    };
    this.#quotes.set(quoteId, updated);
    return updated;
  }

  async transition(
    id: string,
    to: QuoteStatus,
    updatedAt: Date,
    expectedLockVersion?: number,
    log: readonly Omit<QuoteOverrideDecision, 'quoteId'>[] = [],
  ): Promise<Quote | null> {
    const quote = this.#quotes.get(id);
    if (quote === undefined) {
      return null;
    }

    if (expectedLockVersion !== undefined && quote.lockVersion !== expectedLockVersion) {
      throw new StaleAggregateError('quote', id, expectedLockVersion, quote.lockVersion);
    }
    const moved: Quote = {
      ...quote,
      status: to,
      updatedAt: updatedAt.toISOString(),
      lockVersion: quote.lockVersion + 1,
    };
    this.#quotes.set(id, moved);

    if (log.length > 0) {
      this.#decisions.set(id, [
        ...(this.#decisions.get(id) ?? []),
        ...log.map((entry) => ({ ...entry, quoteId: id })),
      ]);
    }
    return moved;
  }

  async recordOverrideDecision(
    quoteId: string,
    approval: { by: string; at: Date } | null,
    entry: Omit<QuoteOverrideDecision, 'quoteId'>,
    updatedAt: Date,
    expectedLockVersion?: number,
    toDraft = false,
  ): Promise<Quote | null> {
    const quote = this.#quotes.get(quoteId);
    if (quote === undefined) {
      return null;
    }

    if (expectedLockVersion !== undefined && quote.lockVersion !== expectedLockVersion) {
      throw new StaleAggregateError('quote', quoteId, expectedLockVersion, quote.lockVersion);
    }
    // Mirrors the primary key on quote_override_decisions in
    // infra/db/migrations/quoting/0000_baseline.sql. Every check runs before the first change, and
    // nothing below awaits, so the pair, the move and the entry land together or not at all.
    if (this.#decisionIdTaken(entry.id)) {
      throw new Error(`override decision "${entry.id}" already exists`);
    }

    const written =
      approval === null ? undefined : { by: approval.by, at: approval.at.toISOString() };
    const price =
      entry.kind === 'price'
        ? written
        : livePair(quote.overrideApprovedBy, quote.overrideApprovedAt);
    const floor =
      entry.kind === 'floor' ? written : livePair(quote.floorOverrideBy, quote.floorOverrideAt);
    // The quote is rebuilt field by field, so a cleared approval or override leaves no stale pair
    // behind.
    const next: Quote = {
      id: quote.id,
      customerId: quote.customerId,
      freightInRollPrice: quote.freightInRollPrice,
      status: toDraft ? 'draft' : quote.status,
      rootQuoteId: quote.rootQuoteId,
      versionNumber: quote.versionNumber,
      quoteNumber: quote.quoteNumber,
      lockVersion: quote.lockVersion + 1,
      ...(quote.salesRep === undefined ? {} : { salesRep: quote.salesRep }),
      ...(quote.notes === undefined ? {} : { notes: quote.notes }),
      ...(quote.leadTimeDays === undefined ? {} : { leadTimeDays: quote.leadTimeDays }),
      ...(quote.leadTimeSetBy === undefined ? {} : { leadTimeSetBy: quote.leadTimeSetBy }),
      ...(quote.leadTimeSetAt === undefined ? {} : { leadTimeSetAt: quote.leadTimeSetAt }),
      createdAt: quote.createdAt,
      ...(price === undefined
        ? {}
        : { overrideApprovedBy: price.by, overrideApprovedAt: price.at }),
      ...(floor === undefined ? {} : { floorOverrideBy: floor.by, floorOverrideAt: floor.at }),
      updatedAt: updatedAt.toISOString(),
    };
    this.#quotes.set(quoteId, next);
    this.#decisions.set(quoteId, [...(this.#decisions.get(quoteId) ?? []), { ...entry, quoteId }]);
    return next;
  }

  async overrideDecisions(quoteId: string): Promise<readonly QuoteOverrideDecision[]> {
    return [...(this.#decisions.get(quoteId) ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  }

  async draftLinesUsingGradeVariant(
    gradeId: string,
    variant: string,
  ): Promise<readonly { quoteId: string; lineNumber: number }[]> {
    const hits: { quoteId: string; lineNumber: number }[] = [];
    for (const [quoteId, lines] of this.#lines) {
      if (this.#quotes.get(quoteId)?.status !== 'draft') continue;
      for (const line of lines) {
        if (line.gradeId === gradeId && line.footageVariant === variant) {
          hits.push({ quoteId, lineNumber: line.lineNumber });
        }
      }
    }

    return hits.sort((a, b) => a.quoteId.localeCompare(b.quoteId) || a.lineNumber - b.lineNumber);
  }

  async draftLinesUsingGradeWidth(
    gradeId: string,
    rollWidthIn: number,
  ): Promise<readonly { quoteId: string; lineNumber: number }[]> {
    const hits: { quoteId: string; lineNumber: number }[] = [];
    for (const [quoteId, lines] of this.#lines) {
      if (this.#quotes.get(quoteId)?.status !== 'draft') continue;
      for (const line of lines) {
        if (
          line.gradeId === gradeId &&
          line.rollWidthIn === rollWidthIn &&
          line.customWidth !== true
        ) {
          hits.push({ quoteId, lineNumber: line.lineNumber });
        }
      }
    }
    return hits.sort((a, b) => a.quoteId.localeCompare(b.quoteId) || a.lineNumber - b.lineNumber);
  }

  async versions(rootQuoteId: string): Promise<readonly Quote[]> {
    return [...this.#quotes.values()]
      .filter((q) => q.rootQuoteId === rootQuoteId)
      .sort((a, b) => a.versionNumber - b.versionNumber);
  }

  async revise(
    originalId: string,
    next: NewQuoteRow,
    lines: readonly NewQuoteLine[],
    at: Date,
    expectedLockVersion?: number,
  ): Promise<QuoteWithLines | null> {
    const original = this.#quotes.get(originalId);
    if (original === undefined) {
      return null;
    }
    if (original.status !== 'quoted') {
      throw new QuoteNotRevisableError(originalId, original.status);
    }
    if (expectedLockVersion !== undefined && original.lockVersion !== expectedLockVersion) {
      throw new StaleAggregateError('quote', originalId, expectedLockVersion, original.lockVersion);
    }

    const taken = [...this.#quotes.values()].some(
      (q) => q.rootQuoteId === next.rootQuoteId && q.versionNumber === next.versionNumber,
    );
    if (taken) {
      throw new QuoteVersionConflictError(next.rootQuoteId, next.versionNumber);
    }

    // Every check runs before the first change, and nothing below awaits, so the next version, its
    // lines and the superseded original land together or not at all: modules/quoting/src/ports.ts.
    const stamp = at.toISOString();
    this.#quotes.set(next.id, { ...this.#newQuote(next), updatedAt: stamp });
    this.#lines.set(
      next.id,
      lines.map((line) => ({ ...line, quoteId: next.id, createdAt: stamp, updatedAt: stamp })),
    );

    this.#quotes.set(originalId, {
      ...original,
      status: 'superseded',
      updatedAt: stamp,
      lockVersion: original.lockVersion + 1,
    });

    return this.findWithLines(next.id);
  }

  async recordSend(input: NewQuoteSend): Promise<QuoteSend> {
    // Mirrors the CHECK on quote_sends.message_id in infra/db/migrations/quoting/0000_baseline.sql.
    if (input.messageId.trim() === '') {
      throw new Error(
        `send record for quote "${input.quoteId}" has a blank message id; ` +
          `a correlation id that correlates to nothing is not one`,
      );
    }
    const send: QuoteSend = {
      id: input.id,
      quoteId: input.quoteId,
      messageId: input.messageId,
      actor: input.actor,
      acceptedByRelayAt: input.acceptedByRelayAt.toISOString(),
    };
    this.#sends.set(send.quoteId, [...(this.#sends.get(send.quoteId) ?? []), send]);
    return send;
  }

  async sendsForChain(rootQuoteId: string): Promise<readonly QuoteSend[]> {
    const chain = [...this.#quotes.values()].filter((q) => q.rootQuoteId === rootQuoteId);
    return chain
      .flatMap((q) => this.#sends.get(q.id) ?? [])
      .sort((a, b) => a.acceptedByRelayAt.localeCompare(b.acceptedByRelayAt));
  }
}
