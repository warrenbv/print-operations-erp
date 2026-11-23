// In-memory `OrderRepository` for unit tests and the memory-mode API.
// modules/orders/test/contracts/order-repository.contract.ts holds it to the Drizzle adapter's behaviour.
import type {
  CountAndOldest,
  Order,
  OrderLine,
  OrderStatus,
  OrderTransition,
  OrderWithLines,
} from '@erp/types';

import type {
  NewOrder,
  NewOrderLine,
  NewOrderWrite,
  OrderListParams,
  OrderPatch,
  OrderRepository,
  PurchaseOrderCapture,
} from '../../ports';
import { formatJobNumber } from '../../job-number';
import { StaleAggregateError } from '../../ports';

interface Row {
  id: string;
  quoteId: string;
  customerId: string;
  status: OrderStatus;
  jobNumber?: string;
  confirmedLeadTimeDays?: number;
  confirmedBy?: string;
  confirmedAt?: Date;
  salesRep?: string;
  poNumber?: string;
  poCapturedBy?: string;
  poCapturedAt?: Date;
  requestedDate?: string;
  createdAt: Date;
  updatedAt: Date;
  lockVersion: number;
}

function byUpdatedAtThenId(a: Row, b: Row): number {
  return a.updatedAt.getTime() - b.updatedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function toOrder(row: Row): Order {
  return {
    id: row.id,
    quoteId: row.quoteId,
    customerId: row.customerId,
    status: row.status,
    ...(row.jobNumber === undefined ? {} : { jobNumber: row.jobNumber }),
    ...(row.confirmedLeadTimeDays === undefined
      ? {}
      : { confirmedLeadTimeDays: row.confirmedLeadTimeDays }),
    ...(row.confirmedBy === undefined ? {} : { confirmedBy: row.confirmedBy }),
    ...(row.confirmedAt === undefined ? {} : { confirmedAt: row.confirmedAt.toISOString() }),
    ...(row.salesRep === undefined ? {} : { salesRep: row.salesRep }),
    ...(row.poNumber === undefined ? {} : { poNumber: row.poNumber }),
    ...(row.poCapturedBy === undefined ? {} : { poCapturedBy: row.poCapturedBy }),
    ...(row.poCapturedAt === undefined ? {} : { poCapturedAt: row.poCapturedAt.toISOString() }),
    ...(row.requestedDate === undefined ? {} : { requestedDate: row.requestedDate }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lockVersion: row.lockVersion,
  };
}

function assertFresh(row: Row, expectedLockVersion: number): void {
  if (row.lockVersion !== expectedLockVersion) {
    throw new StaleAggregateError('order', row.id, expectedLockVersion, row.lockVersion);
  }
}
// Stands in for the unique index order_lines_quote_line_id_order_id_unique.
function assertEachQuoteLineOnce(input: {
  readonly id: string;
  readonly lines: readonly NewOrderLine[];
}): void {
  const seen = new Set<string>();
  for (const line of input.lines) {
    if (line.quoteLineId === undefined) continue;
    if (seen.has(line.quoteLineId)) {
      throw new Error(
        `order "${input.id}" was given quote line "${line.quoteLineId}" more than once`,
      );
    }
    seen.add(line.quoteLineId);
  }
}

export class InMemoryOrderRepository implements OrderRepository {
  readonly #byId = new Map<string, Row>();
  readonly #transitions: OrderTransition[] = [];

  readonly #linesByOrderId = new Map<string, OrderLine[]>();

  // Stands in for orders.job_number_seq, and starts at one as the sequence does.
  #jobNumberCounter = 0;

  async createMany(inputs: readonly NewOrderWrite[]): Promise<readonly OrderWithLines[]> {
    const ids = new Set<string>();
    const openings = new Set<string>();
    for (const input of inputs) {
      assertEachQuoteLineOnce(input);
      if (this.#byId.has(input.id) || ids.has(input.id)) {
        throw new Error(`order "${input.id}" already exists`);
      }
      ids.add(input.id);
      // Stands in for the primary key on order_transitions.
      const opening = input.opening.id;
      if (openings.has(opening) || this.#transitions.some((t) => t.id === opening)) {
        throw new Error(`order history row "${opening}" already exists`);
      }
      openings.add(opening);
    }
    // Every input is checked before any is stored, so a refusal writes nothing, as the
    // Drizzle transaction does.
    return inputs.map((input) => {
      const order = this.#store(input, input.purchaseOrder);
      this.#transitions.push({ ...input.opening, orderId: input.id });
      return order;
    });
  }

  #store(
    input: NewOrder & {
      id: string;
      status: OrderStatus;
      createdAt: Date;
      updatedAt: Date;
      lines: readonly (NewOrderLine & { id: string })[];
    },
    purchaseOrder?: { poNumber: string; capturedBy: string },
  ): OrderWithLines {
    const row: Row = {
      id: input.id,
      quoteId: input.quoteId,
      customerId: input.customerId,
      status: input.status,
      ...(input.salesRep === undefined ? {} : { salesRep: input.salesRep }),
      ...(input.requestedDate === undefined ? {} : { requestedDate: input.requestedDate }),
      ...(purchaseOrder === undefined
        ? {}
        : {
            poNumber: purchaseOrder.poNumber,
            poCapturedBy: purchaseOrder.capturedBy,
            poCapturedAt: input.createdAt,
          }),
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,

      lockVersion: 1,
    };
    this.#byId.set(row.id, row);

    const lines = input.lines
      .map((line) => ({
        ...line,
        orderId: row.id,
        createdAt: input.createdAt.toISOString(),
        updatedAt: input.updatedAt.toISOString(),
      }))
      .sort((a, b) => a.lineNumber - b.lineNumber);
    this.#linesByOrderId.set(row.id, lines);

    return { ...toOrder(row), lines };
  }

  async findById(id: string): Promise<Order | null> {
    const row = this.#byId.get(id);
    return row === undefined ? null : toOrder(row);
  }

  async findWithLines(id: string): Promise<OrderWithLines | null> {
    const row = this.#byId.get(id);
    if (row === undefined) return null;
    return { ...toOrder(row), lines: this.#linesByOrderId.get(id) ?? [] };
  }

  async linesByOrderIds(orderIds: readonly string[]): Promise<readonly OrderLine[]> {
    return orderIds
      .flatMap((orderId) => this.#linesByOrderId.get(orderId) ?? [])
      .sort((a, b) => a.orderId.localeCompare(b.orderId) || a.lineNumber - b.lineNumber);
  }

  async existsForQuote(quoteId: string): Promise<boolean> {
    return [...this.#byId.values()].some((r) => r.quoteId === quoteId);
  }

  async mintJobNumber(): Promise<string> {
    this.#jobNumberCounter += 1;
    return formatJobNumber(this.#jobNumberCounter);
  }

  async list(params: OrderListParams): Promise<readonly Order[]> {
    const listed = this.#filtered(params);

    if (params.sort === 'oldest') {
      listed.sort(byUpdatedAtThenId);
    } else if (params.sort === 'newest') {
      listed.sort((a, b) => byUpdatedAtThenId(b, a));
    }

    const cut = params.limit === undefined ? listed : listed.slice(0, params.limit);
    return cut.map(toOrder);
  }

  async countAndOldest(
    params: Omit<OrderListParams, 'sort' | 'limit'>,
  ): Promise<CountAndOldest<Order>> {
    const listed = this.#filtered(params).sort(byUpdatedAtThenId);
    const [oldest] = listed;
    return { count: listed.length, oldest: oldest === undefined ? null : toOrder(oldest) };
  }

  #filtered(params: OrderListParams): Row[] {
    return [...this.#byId.values()]

      .filter((r) => params.status === undefined || params.status.includes(r.status))
      .filter((r) => params.customerId === undefined || r.customerId === params.customerId)

      .filter((r) => params.quoteIds === undefined || params.quoteIds.includes(r.quoteId))
      .filter((r) => params.poNumber === undefined || r.poNumber === params.poNumber)

      .filter((r) => params.salesRep === undefined || r.salesRep === params.salesRep)

      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async transition(
    id: string,
    to: OrderStatus,
    patch: OrderPatch,
    entry: Omit<OrderTransition, 'orderId'>,
    updatedAt: Date,
    expectedLockVersion?: number,
  ): Promise<Order | null> {
    const row = this.#byId.get(id);
    if (row === undefined) {
      return null;
    }

    if (expectedLockVersion !== undefined) {
      assertFresh(row, expectedLockVersion);
    }

    const next: Row = {
      ...row,
      status: to,
      ...(patch.jobNumber === undefined ? {} : { jobNumber: patch.jobNumber }),
      ...(patch.confirmedLeadTimeDays === undefined
        ? {}
        : { confirmedLeadTimeDays: patch.confirmedLeadTimeDays }),
      ...(patch.confirmedBy === undefined ? {} : { confirmedBy: patch.confirmedBy }),
      ...(patch.confirmedAt === undefined ? {} : { confirmedAt: patch.confirmedAt }),
      updatedAt,
      lockVersion: row.lockVersion + 1,
    };
    this.#byId.set(id, next);

    this.#transitions.push({ ...entry, orderId: id });
    return toOrder(next);
  }

  async capturePurchaseOrder(
    id: string,
    po: PurchaseOrderCapture,
    updatedAt: Date,
    expectedLockVersion: number,
  ): Promise<OrderWithLines | null> {
    const row = this.#byId.get(id);
    if (row === undefined) {
      return null;
    }
    assertFresh(row, expectedLockVersion);

    const next: Row = { ...row, updatedAt, lockVersion: row.lockVersion + 1 };
    if (po.poNumber === undefined) {
      delete next.poNumber;
      delete next.poCapturedBy;
      delete next.poCapturedAt;
    } else {
      next.poNumber = po.poNumber;
      next.poCapturedBy = po.capturedBy;
      next.poCapturedAt = updatedAt;
    }
    this.#byId.set(id, next);
    return this.findWithLines(id);
  }

  async history(orderId: string): Promise<readonly OrderTransition[]> {
    return this.#transitions
      .filter((t) => t.orderId === orderId)
      .sort((a, b) => a.at.localeCompare(b.at));
  }
}
