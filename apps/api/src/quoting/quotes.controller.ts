// Quotes: create, price the lines, the lead time, send, revise, and the two decisions that can stand between a quote and its send.
// Sales edits and sends. Production enters the lead time, the Billing Manager decides a hand-set price, and Admin alone overrides the floor:
// docs/product/requirements.md (R5, R6, R7). The rules live in modules/quoting/src/services/quote-service.ts. This file maps their errors to HTTP replies.
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { sendStoredDocument } from '../documents/send-stored-document';
import {
  BelowFloorQuoteError,
  InvalidQuoteTransitionError,
  NoPalletFitForWidthError,
  WidthNotStockedError,
  NoProductionManagerError,
  NoTierForVolumeError,
  FloorOverrideAlreadyApprovedError,
  NothingBelowFloorError,
  NothingToApproveError,
  OverrideAlreadyApprovedError,
  OverrideNotApprovedError,
  QuoteHasNoLeadTimeError,
  QuoteNeedsLeadTimeError,
  QuoteHasNoRecipientsError,
  QuoteHasOrderError,
  LineJurisdictionMismatchError,
  UnknownTaxJurisdictionError,
  LinePerPoundHandSetPriceError,
  LinePerRollHandSetPoundPriceError,
  LinePerPoundNeedsRollWeightError,
  LinePerPoundNeedsOrderedWeightError,
  LinePerRollOrderedWeightError,
  LineEnteredMarginBelowFloorError,
  LineEnteredMarginHandSetPriceError,
  LineEnteredMarginTierOverrideError,
  QuoteNotEditableError,
  QuoteNotPrintableError,
  QuoteNotRevisableError,
  QuoteRedistributionNotConfirmedError,
  QuoteSendNotRecordedError,
  QuoteSendNotUndoneError,
  QuoteService,
  QuoteVersionConflictError,
  StaleAggregateError,
  CustomerBillingAddressRequiredError,
  CustomerOnCreditHoldError,
  GradeService,
  UnknownCustomerError,
  UnknownFootageVariantError,
  UnknownGradeOnLineError,
  UnknownTierCodeError,
} from '@erp/quoting';
import {
  createQuoteRequestSchema,
  floorOverrideDecisionRequestSchema,
  overrideDecisionRequestSchema,
  quoteCountResponseSchema,
  quoteListResponseSchema,
  quoteOverrideDecisionListResponseSchema,
  quoteReference,
  quoteSchema,
  quoteSendabilitySchema,
  quoteStatusSchema,
  quoteTotalsSchema,
  quoteVersionsResponseSchema,
  quoteWithLinesSchema,
  quoteSendSchema,
  quoteSendAttemptListResponseSchema,
  refusalBody,
  reviseQuoteRequestSchema,
  sendQuoteRequestSchema,
  setQuoteLeadTimeRequestSchema,
  setQuoteLinesRequestSchema,
  transitionQuoteRequestSchema,
  FLOOR_OVERRIDE_ROLES,
  PRICE_OVERRIDE_APPROVAL_ROLES,
  PRINTABLE_QUOTE_STATUSES,
  QUOTE_LEAD_TIME_ROLES,
  SALES_WRITE_ROLES,
  type FloorOverrideDecisionRequest,
  type Quote,
  type QuoteCountResponse,
  type QuoteListResponse,
  type QuoteOverrideDecisionListResponse,
  type QuoteSend,
  type QuoteSendAttemptListResponse,
  type QuoteSendability,
  type QuoteTotals,
  type QuoteVersionsResponse,
  type QuoteWithLines,
  type StoredDocument,
} from '@erp/types';

import type { Response } from 'express';

import { ContactService, CustomerService } from '@erp/crm';
import { DocumentService, DEMO_BRAND, buildQuoteDocument } from '@erp/documents';
import { IDENTITY_STORES, type IdentityStores } from '../auth/auth.factory';
import { resolveRepName } from '../crm/resolve-sales-reps';
import type { MailLog, MailSink, SendLog } from '@erp/notifications';
import { linePapers } from './line-papers';

import {
  MAIL_LOG,
  MAIL_SINK,
  SENDER_NOTIFIER,
  SEND_LOG,
} from '../notifications/notifications.factory';
import {
  recordUnsendableAndNotify,
  type FailureNotifier,
} from '../notifications/notify-sender-of-failure';
import { mapMailFailure } from '../notifications/map-mail-failure';
import { toSendAttempt } from '../notifications/send-attempt';

import { assertRecipientConfirmed } from '../crm/confirm-recipient';
import { recipientsForRole } from '../crm/recipients-for-role';
import { Authenticated, RequireRoles } from '../auth/authz.decorators';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { UuidParam } from '../params.decorators';
import { parseQueueRead, parseRepeatableIds } from '../list-query';
import { parseSalesRepFilter } from '../sales-rep-filter';

function mapQuotingError(err: unknown): never {
  if (err instanceof UnknownCustomerError) {
    throw new UnprocessableEntityException({ reason: 'unknown-customer', value: err.customerId });
  }
  if (err instanceof UnknownGradeOnLineError) {
    throw new UnprocessableEntityException({
      reason: 'unknown-grade-on-line',
      value: err.quoteId,
    });
  }
  if (err instanceof UnknownFootageVariantError) {
    throw new UnprocessableEntityException({
      reason: 'unknown-footage-variant',
      value: err.variant,
    });
  }
  if (err instanceof UnknownTierCodeError) {
    throw new UnprocessableEntityException({ reason: 'unknown-tier-code', value: err.code });
  }
  if (err instanceof NoPalletFitForWidthError) {
    throw new UnprocessableEntityException({
      reason: 'no-pallet-fit-for-width',
      value: err.rollWidthIn,
    });
  }

  if (err instanceof WidthNotStockedError) {
    throw new UnprocessableEntityException({
      reason: 'width-not-stocked',
      value: { lineNumber: err.lineNumber, rollWidthIn: err.rollWidthIn },
      message: err.message,
    });
  }
  if (err instanceof NoTierForVolumeError) {
    throw new UnprocessableEntityException({ reason: 'no-tier-for-volume', value: err.pallets });
  }

  if (err instanceof CustomerBillingAddressRequiredError) {
    throw new ConflictException({
      reason: 'customer-billing-address-required',
      value: err.customerId,
      message: err.message,
    });
  }
  if (err instanceof CustomerOnCreditHoldError) {
    throw new ConflictException({
      reason: 'customer-on-credit-hold',
      value: err.customerId,
      message: err.message,
    });
  }
  if (err instanceof QuoteNotEditableError) {
    throw new ConflictException({ reason: 'quote-not-editable', value: err.status });
  }

  if (err instanceof LineJurisdictionMismatchError) {
    throw new UnprocessableEntityException({
      reason: 'line-jurisdiction-mismatch',
      value: {
        lineNumber: err.lineNumber,
        taxJurisdiction: err.taxJurisdiction,
        shipToState: err.shipToState,
      },
      message: err.message,
    });
  }

  if (err instanceof UnknownTaxJurisdictionError) {
    throw new UnprocessableEntityException({
      reason: 'unknown-tax-jurisdiction',
      value: { lineNumber: err.lineNumber, taxJurisdiction: err.taxJurisdiction },
      message: err.message,
    });
  }

  if (err instanceof LinePerPoundNeedsRollWeightError) {
    throw new UnprocessableEntityException({
      reason: 'per-pound-needs-roll-weight',
      value: { lineNumber: err.lineNumber, gradeId: err.gradeId },
      message: err.message,
    });
  }

  if (err instanceof LinePerPoundHandSetPriceError) {
    throw new UnprocessableEntityException({
      reason: 'per-pound-hand-set-price',
      value: { lineNumber: err.lineNumber },
      message: err.message,
    });
  }

  if (err instanceof LinePerRollHandSetPoundPriceError) {
    throw new UnprocessableEntityException({
      reason: 'per-roll-hand-set-pound-price',
      value: { lineNumber: err.lineNumber },
      message: err.message,
    });
  }

  if (err instanceof LinePerPoundNeedsOrderedWeightError) {
    throw new UnprocessableEntityException({
      reason: 'per-pound-needs-ordered-weight',
      value: { lineNumber: err.lineNumber },
      message: err.message,
    });
  }
  if (err instanceof LinePerRollOrderedWeightError) {
    throw new UnprocessableEntityException({
      reason: 'per-roll-ordered-weight',
      value: { lineNumber: err.lineNumber },
      message: err.message,
    });
  }

  if (err instanceof LineEnteredMarginHandSetPriceError) {
    throw new UnprocessableEntityException({
      reason: 'entered-margin-hand-set-price',
      value: { lineNumber: err.lineNumber },
      message: err.message,
    });
  }
  if (err instanceof LineEnteredMarginTierOverrideError) {
    throw new UnprocessableEntityException({
      reason: 'entered-margin-tier-override',
      value: { lineNumber: err.lineNumber },
      message: err.message,
    });
  }

  if (err instanceof LineEnteredMarginBelowFloorError) {
    throw new UnprocessableEntityException({
      reason: 'entered-margin-below-floor',
      value: {
        lineNumber: err.lineNumber,
        marginOverridePct: err.marginOverridePct,
        floorPct: err.floorPct,
      },
      message: err.message,
    });
  }
  if (err instanceof QuoteNotRevisableError) {
    throw new ConflictException({ reason: 'quote-not-revisable', value: err.status });
  }

  if (err instanceof QuoteNotPrintableError) {
    throw new ConflictException({ reason: 'quote-not-printable', value: err.status });
  }

  if (err instanceof QuoteHasNoLeadTimeError) {
    throw new ConflictException({ reason: 'quote-has-no-lead-time', value: err.quoteId });
  }

  if (err instanceof QuoteNeedsLeadTimeError) {
    throw new ConflictException({ reason: 'quote-needs-lead-time', value: err.quoteId });
  }
  if (err instanceof QuoteVersionConflictError) {
    throw new ConflictException({ reason: 'quote-version-conflict', value: err.versionNumber });
  }

  if (err instanceof StaleAggregateError) {
    throw new ConflictException({
      reason: 'stale-aggregate',
      value: { expected: err.expected, actual: err.actual },
    });
  }
  if (err instanceof InvalidQuoteTransitionError) {
    throw new ConflictException({
      reason: 'invalid-transition',
      value: { from: err.from, to: err.to, allowed: [...err.allowed] },
    });
  }

  if (err instanceof QuoteHasOrderError) {
    throw new ConflictException({ reason: 'quote-has-order', value: err.quoteId });
  }

  if (err instanceof BelowFloorQuoteError) {
    throw new ConflictException({ reason: 'below-floor', value: [...err.lines] });
  }
  if (err instanceof OverrideNotApprovedError) {
    throw new ConflictException({ reason: 'override-not-approved', value: [...err.lines] });
  }
  if (err instanceof NothingToApproveError) {
    throw new ConflictException({ reason: 'nothing-to-approve', value: err.quoteId });
  }

  if (err instanceof OverrideAlreadyApprovedError) {
    throw new ConflictException({
      reason: 'override-already-approved',
      value: { quoteId: err.quoteId, approvedBy: err.approvedBy },
    });
  }

  if (err instanceof NothingBelowFloorError) {
    throw new ConflictException({ reason: 'nothing-below-floor', value: err.quoteId });
  }
  if (err instanceof FloorOverrideAlreadyApprovedError) {
    throw new ConflictException({
      reason: 'floor-override-already-approved',
      value: { quoteId: err.quoteId, overriddenBy: err.overriddenBy },
    });
  }

  if (err instanceof QuoteRedistributionNotConfirmedError) {
    throw new ConflictException({
      reason: 'redistribution-not-confirmed',
      value: err.priorSends.map((send) => ({
        when: send.acceptedByRelayAt,
        messageId: send.messageId,
      })),
    });
  }

  if (err instanceof QuoteHasNoRecipientsError) {
    throw new UnprocessableEntityException({
      reason: 'no-quote-recipient',
      value: err.customerId,
    });
  }

  if (err instanceof QuoteSendNotUndoneError) {
    mapMailFailure(err.cause, true);
  }

  if (err instanceof QuoteSendNotRecordedError) {
    throw new InternalServerErrorException({
      reason: 'send-not-recorded',
      value: err.messageId,
      message: err.message,
    });
  }

  mapMailFailure(err);
}

function isPrintable(quote: Quote): boolean {
  return PRINTABLE_QUOTE_STATUSES.includes(quote.status);
}

// A stored copy shows the quote as it now stands when it was rendered at or after the last write to
// what the document prints: the lines with the freight setting, saved together, and the lead time.
// Those times and `documentAt` come from the one clock the API hands every module. A copy rendered
// for a send the relay refused is passed over once the quote is edited.
function showsAsItStands(stored: StoredDocument, quote: QuoteWithLines): boolean {
  const lastPrintedWrite = Math.max(
    ...quote.lines.map((line) => Date.parse(line.updatedAt)),
    quote.leadTimeSetAt === undefined ? 0 : Date.parse(quote.leadTimeSetAt),
  );
  return Date.parse(stored.documentAt) >= lastPrintedWrite;
}

/** The actor always comes from the session, and replaces any `actor` in the body. */
function withSessionActor(body: unknown, request: AuthenticatedRequest): unknown {
  if (request.erpUser === undefined) {
    throw new UnauthorizedException();
  }
  return {
    ...(typeof body === 'object' && body !== null ? body : {}),
    actor: request.erpUser.username,
  };
}

function parseFloorOverrideDecision(
  body: unknown,
  request: AuthenticatedRequest,
): FloorOverrideDecisionRequest {
  const parsed = overrideDecisionRequestSchema.safeParse(withSessionActor(body, request));
  if (!parsed.success) {
    throw new BadRequestException(refusalBody(parsed.error));
  }
  const floor = floorOverrideDecisionRequestSchema.safeParse(parsed.data);
  if (!floor.success) {
    throw new BadRequestException({ reason: 'floor-override-reason-required' });
  }
  return floor.data;
}

@Controller('quoting/quotes')
export class QuotesController {
  constructor(
    @Inject(QuoteService) private readonly quotes: QuoteService,

    @Inject(CustomerService) private readonly customers: CustomerService,
    @Inject(DocumentService) private readonly documents: DocumentService,

    @Inject(ContactService) private readonly contacts: ContactService,

    @Inject(IDENTITY_STORES) private readonly identity: IdentityStores,

    @Inject(MAIL_LOG) private readonly log: MailLog,

    @Inject(MAIL_SINK) private readonly mail: MailSink,
    @Inject(SEND_LOG) private readonly sendLog: SendLog,

    @Inject(SENDER_NOTIFIER) private readonly notifySender: FailureNotifier,

    @Inject(GradeService) private readonly grades: GradeService,
  ) {}

  @RequireRoles(...SALES_WRITE_ROLES)
  @Post()
  async create(@Body() body: unknown): Promise<Quote> {
    const parsed = createQuoteRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const created = await this.quotes.create(parsed.data);
      return quoteSchema.parse(created);
    } catch (err) {
      mapQuotingError(err);
    }
  }

  @Authenticated()
  @Get()
  async list(
    @Query('status') status: unknown,
    @Query('customerId') customerId: unknown,
    @Query('id') id: unknown,
    @Query('salesRep') salesRep: unknown,
    @Query('quoteNumber') quoteNumber: unknown,
    @Query('leadTime') leadTime: unknown,
    @Query('converted') converted: unknown,
    @Query('count') count: unknown,
    @Query('limit') limit: unknown,
    @Query('sort') sort: unknown,
  ): Promise<QuoteListResponse | QuoteCountResponse> {
    const read = parseQueueRead({ count, limit, sort });
    if (leadTime !== undefined && leadTime !== 'missing') {
      throw new BadRequestException({ reason: 'invalid-lead-time-filter' });
    }
    if (converted !== undefined && converted !== 'false') {
      throw new BadRequestException({ reason: 'invalid-converted-filter' });
    }
    let parsedStatus;
    if (status !== undefined) {
      if (typeof status !== 'string') {
        throw new BadRequestException({ reason: 'invalid-status' });
      }
      const parsed = quoteStatusSchema.safeParse(status);
      if (!parsed.success) {
        throw new BadRequestException(refusalBody(parsed.error));
      }
      parsedStatus = parsed.data;
    }

    const customerIdFilter = parseRepeatableIds(customerId, {
      invalid: 'invalid-customer-id',
      empty: 'empty-customer-id',
    });

    const idFilter = parseRepeatableIds(id, {
      invalid: 'invalid-quote-id',
      empty: 'empty-quote-id',
    });
    let quoteNumberFilter: number | undefined;
    if (quoteNumber !== undefined) {
      if (typeof quoteNumber !== 'string' || !/^[0-9]{1,15}$/.test(quoteNumber)) {
        throw new BadRequestException({ reason: 'invalid-quote-number' });
      }
      quoteNumberFilter = Number(quoteNumber);
      if (quoteNumberFilter < 1) {
        throw new BadRequestException({ reason: 'invalid-quote-number' });
      }
    }
    const salesRepFilter = parseSalesRepFilter(salesRep);
    const filters = {
      ...(parsedStatus === undefined ? {} : { status: parsedStatus }),
      ...(customerIdFilter === undefined ? {} : { customerIds: customerIdFilter }),
      ...(idFilter === undefined ? {} : { ids: idFilter }),
      ...(quoteNumberFilter === undefined ? {} : { quoteNumber: quoteNumberFilter }),
      ...(salesRepFilter === undefined ? {} : { salesRep: salesRepFilter }),
      ...(leadTime === undefined ? {} : { leadTime: 'missing' as const }),
      ...(converted === undefined ? {} : { converted: false as const }),
    };
    if (read.count) {
      return quoteCountResponseSchema.parse(await this.quotes.countAndOldest(filters));
    }
    const items = await this.quotes.list({
      ...filters,
      ...(read.sort === undefined ? {} : { sort: read.sort }),
      ...(read.limit === undefined ? {} : { limit: read.limit }),
    });

    const told = await this.sendLog.latestOfKindFor(
      'quote',
      items.map((item) => item.id),
      'lead-time-request',
    );
    return quoteListResponseSchema.parse({
      items: items.map((item) => ({
        ...item,
        productionToldAt: told.get(item.id)?.submittedAt.toISOString() ?? null,
      })),
    });
  }

  @Authenticated()
  @Get(':id')
  async findById(@UuidParam('id') id: string): Promise<QuoteWithLines> {
    const found = await this.quotes.findWithLines(id);
    if (found === null) {
      throw new NotFoundException();
    }
    return quoteWithLinesSchema.parse(found);
  }

  @RequireRoles(...SALES_WRITE_ROLES)
  @Put(':id/lines')
  async setLines(
    @UuidParam('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<QuoteWithLines> {
    const parsed = setQuoteLinesRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    let saved;
    try {
      saved = await this.quotes.setLines(
        id,
        parsed.data.lines,
        parsed.data.lockVersion,
        parsed.data.freightInRollPrice === undefined
          ? {}
          : { freightInRollPrice: parsed.data.freightInRollPrice },
      );
      if (saved === null) {
        // A null means no such quote or a grade that does not exist. The lookup tells them apart.
        if ((await this.quotes.findById(id)) === null) {
          throw new NotFoundException();
        }
        throw new UnprocessableEntityException({ reason: 'unknown-grade-on-line', value: id });
      }
    } catch (err) {
      mapQuotingError(err);
    }

    await this.#askProductionForLeadTime(saved, request.erpUser?.username ?? 'system');
    return quoteWithLinesSchema.parse(saved);
  }

  // Saving lines asks Production for the lead time: docs/product/requirements.md (R5). The alert never fails the save.
  // The second catch keeps a failure while recording the gap from escaping too.
  async #askProductionForLeadTime(saved: QuoteWithLines, actor: string): Promise<void> {
    await this.quotes
      .askProductionForLeadTime(saved.id, actor)
      .catch(async (cause: unknown) => {
        const gap = cause instanceof NoProductionManagerError ? cause : undefined;
        this.log.error({
          kind: 'notification',
          event: 'lead_time_alert_failed',
          quoteId: saved.id,
          ...(gap === undefined
            ? {}
            : { reason: gap.reason, unreachableHolders: gap.holdersWithoutEmail }),
          error: cause instanceof Error ? cause.message : String(cause),
        });
        if (gap !== undefined) {
          await recordUnsendableAndNotify(
            {
              mail: this.mail,
              sendLog: this.sendLog,
              log: this.log,
              notifySender: this.notifySender,
            },
            {
              subject: { type: 'quote', id: saved.id, label: quoteReference(saved) },
              actor,
              reason: gap.reason,
              unreachableHolders: gap.holdersWithoutEmail,
              kind: 'lead-time-request',
              stands: 'Your lines were saved as normal.',
            },
          );
        }
      })

      .catch((cause: unknown) => {
        this.log.error({
          kind: 'notification',
          event: 'lead_time_alert_failed',
          quoteId: saved.id,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      });
  }

  @RequireRoles(...QUOTE_LEAD_TIME_ROLES)
  @Put(':id/lead-time')
  async setLeadTime(
    @UuidParam('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<Quote> {
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    const parsed = setQuoteLeadTimeRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const saved = await this.quotes.setLeadTime(id, parsed.data, request.erpUser.username);
      if (saved === null) {
        throw new NotFoundException();
      }
      return quoteSchema.parse(saved);
    } catch (err) {
      mapQuotingError(err);
    }
  }

  @RequireRoles(...SALES_WRITE_ROLES)
  @Post(':id/transition')
  @HttpCode(200)
  async transition(
    @UuidParam('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<Quote> {
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    const parsed = transitionQuoteRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const moved = await this.quotes.transition(
        id,
        parsed.data.to,
        parsed.data.lockVersion,
        request.erpUser.username,
      );
      if (moved === null) {
        throw new NotFoundException();
      }
      return quoteSchema.parse(moved);
    } catch (err) {
      mapQuotingError(err);
    }
  }

  @Authenticated()
  @Get(':id/sendability')
  async sendability(@UuidParam('id') id: string): Promise<QuoteSendability> {
    const verdict = await this.quotes.sendability(id);
    if (verdict === null) {
      throw new NotFoundException();
    }
    return quoteSendabilitySchema.parse(verdict);
  }

  @Authenticated()
  @Get(':id/document')
  async document(@UuidParam('id') id: string, @Res({ passthrough: true }) res: Response) {
    const stored = await this.#quoteDocument(id);

    return sendStoredDocument(res, stored, await this.documents.read(stored), { inline: true });
  }

  // Serves the newest stored copy when it shows the quote as it now stands, and renders one
  // otherwise. `printableQuote` in modules/quoting/src/services/quote-service.ts refuses a quote that
  // is not fit to print.
  async #quoteDocument(id: string): Promise<StoredDocument> {
    const current = await this.quotes.findWithLines(id);
    if (current !== null && isPrintable(current)) {
      const existing = await this.documents.listForSubject({ type: 'quote', id });
      const stored = existing.find((doc) => doc.kind === 'quote');
      if (stored !== undefined && showsAsItStands(stored, current)) {
        return stored;
      }
    }

    const quote = await this.quotes.printableQuote(id).catch(mapQuotingError);
    if (quote === null) {
      throw new NotFoundException();
    }

    const totals = await this.quotes.totals(id);
    const customer = await this.customers.findById(quote.customerId);
    if (totals === null || customer === null) {
      throw new NotFoundException();
    }

    const salesRepName = await resolveRepName(this.identity.users, quote.salesRep);
    const model = buildQuoteDocument({
      brand: DEMO_BRAND,
      quote,
      totals,
      customerName: customer.name,

      papers: await linePapers(
        quote.lines.map((line) => line.gradeId),
        (gradeId) => this.grades.findById(gradeId),
      ),
      ...(salesRepName === undefined ? {} : { salesRepName }),
    });

    return this.documents.renderAndStore(
      'quote',
      quoteReference(quote),
      { type: 'quote', id: quote.id },
      model,
    );
  }

  @RequireRoles(...SALES_WRITE_ROLES)
  @Post(':id/send')
  @HttpCode(200)
  async send(
    @UuidParam('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<QuoteSend> {
    const parsed = sendQuoteRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }

    const header = await this.quotes.findById(id);
    if (header === null) {
      throw new NotFoundException();
    }
    // Only the contacts tagged for quotes: docs/product/requirements.md (R1). The confirmed list is compared before anything is sent.
    const recipients = await recipientsForRole(this.contacts, header.customerId, 'quote');

    assertRecipientConfirmed(parsed.data.confirmRecipients, recipients);

    const actor = request.erpUser.username;
    const recorded = await this.quotes
      .send(id, parsed.data, recipients, () => this.#quoteDocument(id), actor)
      .catch((err: unknown) => {
        // The email did not go out and the quote still shows as sent, so the state is logged.
        if (err instanceof QuoteSendNotUndoneError) {
          this.log.error({
            kind: 'mail',
            event: 'quote_send_undo_failed',
            quoteId: err.quoteId,
            reason: err.reason,
            error: err.cause instanceof Error ? err.cause.message : String(err.cause),
            ...(err.undoError === undefined
              ? {}
              : {
                  undoError:
                    err.undoError instanceof Error ? err.undoError.message : String(err.undoError),
                }),
          });
        }
        // The customer has the email, so the record it lacks is logged in full for reconciling.
        if (err instanceof QuoteSendNotRecordedError) {
          this.log.error({
            kind: 'mail',
            event: 'quote_send_not_recorded',
            quoteId: err.quoteId,
            messageId: err.messageId,
            actor: err.actor,
            acceptedByRelayAt: err.acceptedByRelayAt.toISOString(),
            error: err.cause instanceof Error ? err.cause.message : String(err.cause),
          });
        }
        return mapQuotingError(err);
      });
    if (recorded === null) {
      throw new NotFoundException();
    }
    // The production alert follows the customer send. Its failure is logged and recorded, and never fails the send.
    await this.quotes.notifyProductionManagers(recorded).catch(async (cause: unknown) => {
      const gap = cause instanceof NoProductionManagerError ? cause : undefined;
      this.log.error({
        kind: 'notification',
        event: 'quote_sent_alert_failed',
        quoteId: id,
        messageId: recorded.messageId,

        ...(gap === undefined
          ? {}
          : { reason: gap.reason, unreachableHolders: gap.holdersWithoutEmail }),
        error: cause instanceof Error ? cause.message : String(cause),
      });
      if (gap !== undefined) {
        await recordUnsendableAndNotify(
          {
            mail: this.mail,
            sendLog: this.sendLog,
            log: this.log,
            notifySender: this.notifySender,
          },
          {
            subject: { type: 'quote', id, label: quoteReference(header) },
            actor: request.erpUser?.username ?? 'system',
            reason: gap.reason,
            unreachableHolders: gap.holdersWithoutEmail,

            stands: 'The quote itself went to the customer as normal.',
          },
        );
      }
    });

    return quoteSendSchema.parse(recorded);
  }

  @Authenticated()
  @Get(':id/sends')
  async sends(@UuidParam('id') id: string): Promise<QuoteSendAttemptListResponse> {
    if ((await this.quotes.findById(id)) === null) {
      throw new NotFoundException();
    }

    const history = await this.sendLog.historyFor({ type: 'quote', id });

    return quoteSendAttemptListResponseSchema.parse({ items: history.map(toSendAttempt) });
  }

  @Authenticated()
  @Get(':id/totals')
  async totals(@UuidParam('id') id: string): Promise<QuoteTotals> {
    const totals = await this.quotes.totals(id);
    if (totals === null) {
      throw new NotFoundException();
    }
    return quoteTotalsSchema.parse(totals);
  }

  @Authenticated()
  @Get(':id/versions')
  async versions(@UuidParam('id') id: string): Promise<QuoteVersionsResponse> {
    const items = await this.quotes.versions(id);
    return quoteVersionsResponseSchema.parse({ items: [...items] });
  }

  @RequireRoles(...SALES_WRITE_ROLES)
  @Post(':id/revise')
  @HttpCode(200)
  async revise(@UuidParam('id') id: string, @Body() body: unknown): Promise<QuoteWithLines> {
    const parsed = reviseQuoteRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const next = await this.quotes.revise(id, parsed.data);
      if (next === null) {
        throw new NotFoundException();
      }
      return quoteWithLinesSchema.parse(next);
    } catch (err) {
      mapQuotingError(err);
    }
  }

  @RequireRoles(...PRICE_OVERRIDE_APPROVAL_ROLES)
  @Post(':id/override/approve')
  @HttpCode(200)
  async approveOverride(
    @UuidParam('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<Quote> {
    const parsed = overrideDecisionRequestSchema.safeParse(withSessionActor(body, request));
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const approved = await this.quotes.approveOverride(id, parsed.data);
      if (approved === null) {
        throw new NotFoundException();
      }
      return quoteSchema.parse(approved);
    } catch (err) {
      mapQuotingError(err);
    }
  }

  @RequireRoles(...PRICE_OVERRIDE_APPROVAL_ROLES)
  @Post(':id/override/reject')
  @HttpCode(200)
  async rejectOverride(
    @UuidParam('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<Quote> {
    const parsed = overrideDecisionRequestSchema.safeParse(withSessionActor(body, request));
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    const { reason } = parsed.data;
    // A rejection needs a reason.
    if (reason === undefined || reason === '') {
      throw new BadRequestException({ reason: 'rejection-reason-required' });
    }
    try {
      const rejected = await this.quotes.rejectOverride(id, { ...parsed.data, reason });
      if (rejected === null) {
        throw new NotFoundException();
      }
      return quoteSchema.parse(rejected);
    } catch (err) {
      mapQuotingError(err);
    }
  }

  @RequireRoles(...FLOOR_OVERRIDE_ROLES)
  @Post(':id/floor-override/approve')
  @HttpCode(200)
  async approveFloorOverride(
    @UuidParam('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<Quote> {
    const decision = parseFloorOverrideDecision(body, request);
    try {
      const approved = await this.quotes.approveFloorOverride(id, decision);
      if (approved === null) {
        throw new NotFoundException();
      }
      return quoteSchema.parse(approved);
    } catch (err) {
      mapQuotingError(err);
    }
  }

  @RequireRoles(...FLOOR_OVERRIDE_ROLES)
  @Post(':id/floor-override/reject')
  @HttpCode(200)
  async rejectFloorOverride(
    @UuidParam('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<Quote> {
    const decision = parseFloorOverrideDecision(body, request);
    try {
      const rejected = await this.quotes.rejectFloorOverride(id, decision);
      if (rejected === null) {
        throw new NotFoundException();
      }
      return quoteSchema.parse(rejected);
    } catch (err) {
      mapQuotingError(err);
    }
  }

  @Authenticated()
  @Get(':id/override/decisions')
  async overrideDecisions(@UuidParam('id') id: string): Promise<QuoteOverrideDecisionListResponse> {
    const items = await this.quotes.overrideDecisions(id);
    return quoteOverrideDecisionListResponseSchema.parse({ items: [...items] });
  }
}
