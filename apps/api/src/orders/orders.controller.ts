// Orders: conversion from a quote, the PO, confirmation by Production, the confirmation document, and the reads.
// Conversion and the PO are open to any signed-in user: docs/product/requirements.md (R10). Confirming is gated: docs/product/requirements.md (R11).
// The rules live in modules/orders/src/services/order-service.ts. This file maps its errors to HTTP replies.
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UnprocessableEntityException,
  UseInterceptors,
  UploadedFile as UploadedFileParam,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CustomerService } from '@erp/crm';

import { assertRecipientConfirmed } from '../crm/confirm-recipient';
import { resolveRepName } from '../crm/resolve-sales-reps';
import { IDENTITY_STORES, type IdentityStores } from '../auth/auth.factory';
import type { MailLog, MailSink, SendLog } from '@erp/notifications';
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
import { redirectedTo } from '../notifications/redirected-to';
import { toSendAttempt } from '../notifications/send-attempt';
import { mapMailFailure } from '../notifications/map-mail-failure';
import { DocumentService, DEMO_BRAND, buildOrderConfirmationDocument } from '@erp/documents';
import { GradeService, QuoteService } from '@erp/quoting';
import { linePapers } from '../quoting/line-papers';
import {
  EmptyQuoteError,
  PerPoundLineNeedsRollWeightError,
  InvalidOrderTransitionError,
  MissingConfirmationDetailsError,
  NoConfirmationRecipientError,
  NoProductionManagerError,
  OrderNotConfirmedError,
  OrderService,
  OrderedWeightOnPerRollQuoteLineError,
  PerPoundLineNeedsPoundsError,
  QuoteFailsSendChecksError,
  StaleAggregateError,
  UnknownQuoteError,
  UnknownQuoteLineError,
} from '@erp/orders';
import {
  RECEIVED_DOCUMENT_MAX_BYTES,
  capturePurchaseOrderRequestSchema,
  confirmOrderRequestSchema,
  createOrderRequestSchema,
  createOrdersRequestSchema,
  createOrdersResponseSchema,
  orderDocumentListResponseSchema,
  orderCountResponseSchema,
  orderLinesLookupResponseSchema,
  orderListResponseSchema,
  orderSchema,
  orderStatusSchema,
  orderSubjectLabel,
  orderTotalsLookupQuerySchema,
  orderTotalsLookupResponseSchema,
  orderTotalsSchema,
  orderTransitionListResponseSchema,
  quoteSendAttemptListResponseSchema,
  orderWithLinesSchema,
  confirmationIssuedResponseSchema,
  refusalBody,
  storedDocumentSummarySchema,
  type ConfirmationIssuedResponse,
  type CreateOrdersResponse,
  type Order,
  type OrderDocumentListResponse,
  type OrderCountResponse,
  type OrderLinesLookupResponse,
  type OrderListResponse,
  type OrderStatus,
  type OrderTotals,
  type OrderTotalsLookupResponse,
  type OrderTransitionListResponse,
  type QuoteSendAttemptListResponse,
  type OrderWithLines,
  type StoredDocumentSummary,
  ORDER_CONFIRMATION_SEND_ROLES,
  ORDER_CONFIRM_ROLES,
  confirmRecipientRequestSchema,
} from '@erp/types';

import { Authenticated, RequireRoles } from '../auth/authz.decorators';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { sendStoredDocument } from '../documents/send-stored-document';

import {
  decodeMultipartFilename,
  mapDocumentsError,
  type UploadedFile,
} from '../documents/received-upload';
import { UuidParam } from '../params.decorators';
import { parseQueueRead, parseRepeatableIds } from '../list-query';
import { parseSalesRepFilter } from '../sales-rep-filter';

/**
 * Maps each orders error to its HTTP reply. A stale `lockVersion` is 409: docs/decisions/006-optimistic-concurrency.md.
 * Anything unmapped goes to the mail failure mapping, which rethrows what it does not know.
 */
function mapOrdersError(err: unknown): never {
  if (err instanceof UnknownQuoteError) {
    throw new UnprocessableEntityException({ reason: 'unknown-quote', value: err.quoteId });
  }

  if (err instanceof EmptyQuoteError) {
    throw new UnprocessableEntityException({ reason: 'empty-quote', value: err.quoteId });
  }

  if (err instanceof QuoteFailsSendChecksError) {
    throw new UnprocessableEntityException({
      reason: 'quote-fails-send-checks',
      value: { quoteId: err.quoteId, check: err.check, lines: [...err.lines] },
      message: err.message,
    });
  }

  if (err instanceof PerPoundLineNeedsRollWeightError) {
    throw new UnprocessableEntityException({
      reason: 'per-pound-order-needs-roll-weight',
      value: { quoteId: err.quoteId, lineNumber: err.lineNumber },
      message: err.message,
    });
  }

  if (err instanceof UnknownQuoteLineError) {
    throw new BadRequestException({
      reason: 'unknown-quote-line',
      value: { quoteId: err.quoteId, quoteLineId: err.quoteLineId },
    });
  }

  if (err instanceof OrderedWeightOnPerRollQuoteLineError) {
    throw new UnprocessableEntityException({
      reason: 'per-roll-ordered-weight',
      value: { quoteLineId: err.quoteLineId, lineNumber: err.lineNumber },
    });
  }

  if (err instanceof PerPoundLineNeedsPoundsError) {
    throw new UnprocessableEntityException({
      reason: 'per-pound-line-needs-pounds',
      value: { quoteLineId: err.quoteLineId, lineNumber: err.lineNumber },
      message: err.message,
    });
  }

  if (err instanceof OrderNotConfirmedError) {
    throw new ConflictException({
      reason: 'order-not-confirmed',
      value: { orderId: err.orderId, status: err.status },
    });
  }

  if (err instanceof NoConfirmationRecipientError) {
    throw new UnprocessableEntityException({
      reason: 'no-order-confirmation-recipient',
      value: { orderId: err.orderId, customerId: err.customerId },
    });
  }

  if (err instanceof MissingConfirmationDetailsError) {
    throw new BadRequestException({
      reason: 'confirmation-details-required',
      value: err.missing,
    });
  }

  if (err instanceof StaleAggregateError) {
    throw new ConflictException({
      reason: 'stale-aggregate',
      value: { aggregate: err.aggregate, expected: err.expected, actual: err.actual },
    });
  }

  if (err instanceof InvalidOrderTransitionError) {
    throw new ConflictException({
      reason: 'invalid-transition',
      value: { from: err.from, to: err.to, allowed: [...err.allowed] },
    });
  }

  mapMailFailure(err);
}

@Controller('orders')
export class OrdersController {
  constructor(
    @Inject(OrderService) private readonly orders: OrderService,
    @Inject(DocumentService) private readonly documents: DocumentService,

    @Inject(CustomerService) private readonly customers: CustomerService,

    @Inject(MAIL_LOG) private readonly log: MailLog,

    @Inject(IDENTITY_STORES) private readonly identity: IdentityStores,

    @Inject(MAIL_SINK) private readonly mail: MailSink,
    @Inject(SEND_LOG) private readonly sendLog: SendLog,

    @Inject(SENDER_NOTIFIER) private readonly notifySender: FailureNotifier,

    @Inject(GradeService) private readonly grades: GradeService,

    @Inject(QuoteService) private readonly quotes: QuoteService,
  ) {}
  @RequireRoles(...ORDER_CONFIRMATION_SEND_ROLES)
  @Post(':id/confirmation')
  @HttpCode(200)
  async issueConfirmation(
    @UuidParam('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<ConfirmationIssuedResponse> {
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    const confirmed = confirmRecipientRequestSchema.safeParse(body ?? {});
    if (!confirmed.success) {
      throw new BadRequestException(refusalBody(confirmed.error));
    }

    const issuable = await this.orders.confirmationIssuable(id).catch(mapOrdersError);
    if (issuable === null) {
      throw new NotFoundException();
    }
    // Checked before anything is rendered, so a changed contact list stops the send with nothing stored.
    assertRecipientConfirmed(confirmed.data.confirmRecipients, issuable.to);

    const order = await this.orders.findWithLines(id);
    if (order === null) {
      throw new NotFoundException();
    }

    const totals = await this.orders.totals(id);
    const customer = await this.customers.findById(order.customerId);
    if (totals === null || customer === null) {
      throw new NotFoundException();
    }

    const salesRepName = await resolveRepName(this.identity.users, order.salesRep);

    const quote = await this.quotes.findById(order.quoteId);
    const model = buildOrderConfirmationDocument({
      brand: DEMO_BRAND,
      order,
      totals,
      freightInRollPrice: quote?.freightInRollPrice ?? false,
      customerName: customer.name,

      papers: await linePapers(
        order.lines.map((line) => line.gradeId),
        (gradeId) => this.grades.findById(gradeId),
      ),
      ...(salesRepName === undefined ? {} : { salesRepName }),
    });

    const stored = await this.documents
      .renderAndStore(
        'order_confirmation',
        order.jobNumber ?? order.id,
        { type: 'order', id: order.id },
        model,
      )
      .catch(mapDocumentsError);

    // The send log names the user who pressed send, taken from the session.
    const issued = await this.orders
      .issueConfirmation(order.id, stored, { actor: request.erpUser.username })
      .catch(mapOrdersError);
    if (issued === null) {
      throw new NotFoundException();
    }

    const actual = redirectedTo(this.mail, issued.recipients);

    return confirmationIssuedResponseSchema.parse({
      document: stored,
      recipients: issued.recipients,
      messageId: issued.messageId,
      issuedAt: issued.issuedAt.toISOString(),
      ...(actual === undefined ? {} : { redirectedTo: [...actual] }),
    });
  }

  // Sales cannot confirm: docs/product/requirements.md (R11).
  @RequireRoles(...ORDER_CONFIRM_ROLES)
  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(
    @UuidParam('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<Order> {
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    const parsed = confirmOrderRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const confirmed = await this.orders.transition(
        id,
        { to: 'confirmed' },
        {
          actor: request.erpUser.username,
          confirmedLeadTimeDays: parsed.data.confirmedLeadTimeDays,

          expectedLockVersion: parsed.data.lockVersion,
        },
      );
      if (confirmed === null) {
        throw new NotFoundException();
      }
      return orderSchema.parse(confirmed);
    } catch (err) {
      mapOrdersError(err);
    }
  }

  // Any signed-in user may convert, and the converter is taken from the session: docs/product/requirements.md (R10).
  @Authenticated()
  @Post()
  async create(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<OrderWithLines> {
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    const parsed = createOrderRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const created = await this.orders.createFromQuote(parsed.data, {
        actor: request.erpUser.username,
      });
      await this.alertProductionManagers(created, request.erpUser.username);
      return orderWithLinesSchema.parse(created);
    } catch (err) {
      mapOrdersError(err);
    }
  }

  @Authenticated()
  @Post('deliveries')
  async createDeliveries(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<CreateOrdersResponse> {
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    const parsed = createOrdersRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const made = await this.orders.createOrdersFromQuote(parsed.data, {
        actor: request.erpUser.username,
      });
      for (const order of made) {
        await this.alertProductionManagers(order, request.erpUser.username);
      }
      return createOrdersResponseSchema.parse({ items: made });
    } catch (err) {
      mapOrdersError(err);
    }
  }

  // Runs after the order exists. A failed alert is logged and recorded, and never fails the conversion.
  private async alertProductionManagers(order: Order, actor: string): Promise<void> {
    const { id } = order;
    await this.orders.notifyOrderReceived(id).catch(async (cause: unknown) => {
      const gap = cause instanceof NoProductionManagerError ? cause : undefined;
      this.log.error({
        kind: 'notification',
        event: 'order_received_alert_failed',
        orderId: id,

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
            subject: { type: 'order', id, label: orderSubjectLabel(order) },
            actor,
            reason: gap.reason,
            unreachableHolders: gap.holdersWithoutEmail,

            stands: 'The order itself is recorded as normal.',
          },
        );
      }
    });
  }

  @Authenticated()
  @Get()
  async list(
    @Query('status') status: unknown,
    @Query('customerId') customerId: unknown,
    @Query('quoteId') quoteId: unknown,
    @Query('poNumber') poNumber: unknown,
    @Query('salesRep') salesRep: unknown,
    @Query('count') count: unknown,
    @Query('limit') limit: unknown,
    @Query('sort') sort: unknown,
  ): Promise<OrderListResponse | OrderCountResponse> {
    const read = parseQueueRead({ count, limit, sort });
    let parsedStatus: OrderStatus[] | undefined;
    if (status !== undefined) {
      const raw = Array.isArray(status) ? status : [status];
      if (raw.length === 0 || raw.some((v) => typeof v !== 'string' || v === '')) {
        throw new BadRequestException({ reason: 'invalid-status' });
      }
      const parsed = orderStatusSchema.array().safeParse(raw);
      if (!parsed.success) {
        throw new BadRequestException(refusalBody(parsed.error));
      }

      parsedStatus = [...new Set(parsed.data)];
    }
    let customerIdFilter: string | undefined;
    if (customerId !== undefined) {
      if (typeof customerId !== 'string') {
        throw new BadRequestException({ reason: 'invalid-customer-id' });
      }
      if (customerId === '') {
        throw new BadRequestException({ reason: 'empty-customer-id' });
      }
      customerIdFilter = customerId;
    }

    const quoteIdFilter = parseRepeatableIds(quoteId, {
      invalid: 'invalid-quote-id',
      empty: 'empty-quote-id',
    });

    let poNumberFilter: string | undefined;
    if (poNumber !== undefined) {
      if (typeof poNumber !== 'string') {
        throw new BadRequestException({ reason: 'invalid-po-number' });
      }
      if (poNumber === '') {
        throw new BadRequestException({ reason: 'empty-po-number' });
      }
      poNumberFilter = poNumber;
    }

    const salesRepFilter = parseSalesRepFilter(salesRep);

    const filters = {
      ...(parsedStatus === undefined ? {} : { status: parsedStatus }),
      ...(customerIdFilter === undefined ? {} : { customerId: customerIdFilter }),
      ...(quoteIdFilter === undefined ? {} : { quoteIds: quoteIdFilter }),
      ...(poNumberFilter === undefined ? {} : { poNumber: poNumberFilter }),
      ...(salesRepFilter === undefined ? {} : { salesRep: salesRepFilter }),
    };
    if (read.count) {
      return orderCountResponseSchema.parse(await this.orders.countAndOldest(filters));
    }

    const items = await this.orders.list({
      ...filters,
      ...(read.sort === undefined ? {} : { sort: read.sort }),
      ...(read.limit === undefined ? {} : { limit: read.limit }),
    });
    return orderListResponseSchema.parse({ items: [...items] });
  }

  @Authenticated()
  @Get('totals')
  async totalsByIds(@Query('ids') ids: unknown): Promise<OrderTotalsLookupResponse> {
    if (typeof ids !== 'string') {
      throw new BadRequestException({ reason: 'invalid-ids' });
    }
    const parsed = orderTotalsLookupQuerySchema.safeParse({ ids });
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    const totals = await this.orders.totalsByIds(parsed.data.ids);
    return orderTotalsLookupResponseSchema.parse({
      items: [...totals].map(([orderId, t]) => ({ orderId, totals: t })),
    });
  }

  @Authenticated()
  @Get('lines')
  async linesByIds(@Query('ids') ids: unknown): Promise<OrderLinesLookupResponse> {
    if (typeof ids !== 'string') {
      throw new BadRequestException({ reason: 'invalid-ids' });
    }
    const parsed = orderTotalsLookupQuerySchema.safeParse({ ids });
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    const lines = await this.orders.linesByOrderIds(parsed.data.ids);
    return orderLinesLookupResponseSchema.parse({
      items: [...lines].map(([orderId, orderLines]) => ({ orderId, lines: orderLines })),
    });
  }

  @Authenticated()
  @Get(':id')
  async findById(@UuidParam('id') id: string): Promise<OrderWithLines> {
    const found = await this.orders.findWithLines(id);
    if (found === null) {
      throw new NotFoundException();
    }
    return orderWithLinesSchema.parse(found);
  }

  @Authenticated()
  @Get(':id/totals')
  async totals(@UuidParam('id') id: string): Promise<OrderTotals> {
    const totals = await this.orders.totals(id);
    if (totals === null) {
      throw new NotFoundException();
    }
    return orderTotalsSchema.parse(totals);
  }

  @Authenticated()
  @Get(':id/transitions')
  async transitions(@UuidParam('id') id: string): Promise<OrderTransitionListResponse> {
    const order = await this.orders.findById(id);
    if (order === null) {
      throw new NotFoundException();
    }
    return orderTransitionListResponseSchema.parse({ items: [...(await this.orders.history(id))] });
  }

  @Authenticated()
  @Get(':id/sends')
  async sends(@UuidParam('id') id: string): Promise<QuoteSendAttemptListResponse> {
    if ((await this.orders.findById(id)) === null) {
      throw new NotFoundException();
    }
    const history = await this.sendLog.historyFor({ type: 'order', id });

    return quoteSendAttemptListResponseSchema.parse({ items: history.map(toSendAttempt) });
  }

  @Authenticated()
  @Put(':id/purchase-order')
  async capturePurchaseOrder(
    @UuidParam('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<OrderWithLines> {
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    const parsed = capturePurchaseOrderRequestSchema.safeParse({
      ...(typeof body === 'object' && body !== null ? body : {}),
      // Placed after the spread, so the session overrides any `capturedBy` in the body.
      capturedBy: request.erpUser.username,
    });
    if (!parsed.success) {
      throw new BadRequestException(refusalBody(parsed.error));
    }
    try {
      const captured = await this.orders.capturePurchaseOrder(id, parsed.data);
      if (captured === null) {
        throw new NotFoundException();
      }

      return orderWithLinesSchema.parse(captured);
    } catch (err) {
      mapOrdersError(err);
    }
  }

  @Authenticated()
  @Post(':id/purchase-order/document')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: RECEIVED_DOCUMENT_MAX_BYTES, files: 1 } }),
  )
  async uploadPurchaseOrderDocument(
    @UuidParam('id') id: string,
    @UploadedFileParam() file: UploadedFile | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<StoredDocumentSummary> {
    if (request.erpUser === undefined) {
      throw new UnauthorizedException();
    }
    if (file === undefined) {
      throw new BadRequestException({ reason: 'no-file' });
    }

    const order = await this.orders.findById(id);
    if (order === null) {
      throw new NotFoundException();
    }

    try {
      const stored = await this.documents.storeReceived({
        kind: 'purchase_order',
        subject: { type: 'order', id: order.id },
        filename: decodeMultipartFilename(file.originalname),

        declaredContentType: file.mimetype,
        bytes: new Uint8Array(file.buffer),

        uploadedBy: request.erpUser.username,
      });
      return storedDocumentSummarySchema.parse(stored);
    } catch (err) {
      mapDocumentsError(err);
    }
  }

  @Authenticated()
  @Get(':id/documents')
  async listDocuments(@UuidParam('id') id: string): Promise<OrderDocumentListResponse> {
    const order = await this.orders.findById(id);
    if (order === null) {
      throw new NotFoundException();
    }
    const documents = await this.documents.listForSubject({ type: 'order', id: order.id });
    return orderDocumentListResponseSchema.parse({ documents });
  }

  @Authenticated()
  @Get(':id/documents/:documentId')
  async document(
    @UuidParam('id') id: string,
    @UuidParam('documentId') documentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    // Found among this order's own documents, so a document id from another order is 404.
    const filed = await this.documents.listForSubject({ type: 'order', id });
    const stored = filed.find((doc) => doc.id === documentId);
    if (stored === undefined) {
      throw new NotFoundException();
    }
    return sendStoredDocument(res, stored, await this.documents.read(stored), { inline: false });
  }
}
