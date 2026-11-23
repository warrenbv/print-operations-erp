// Shared parsing for list routes: repeatable id filters, and the queue read that asks for a count or a sorted, limited page.
// Each refusal is 400 with a reason word, so a malformed filter is never read as no filter.
import { BadRequestException } from '@nestjs/common';
import {
  CUSTOMER_SEARCH_MAX_LIMIT,
  QUEUE_LIMIT_MAX,
  QUEUE_SORTS,
  type QueueSort,
} from '@erp/types';

export function parseRepeatableIds(
  value: unknown,
  reasons: { invalid: string; empty: string },
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const values: unknown[] = Array.isArray(value) ? value : [value];
  if (
    values.length > CUSTOMER_SEARCH_MAX_LIMIT ||
    !values.every((entry): entry is string => typeof entry === 'string')
  ) {
    throw new BadRequestException({ reason: reasons.invalid });
  }
  if (values.some((entry) => entry === '')) {
    throw new BadRequestException({ reason: reasons.empty });
  }
  return values;
}

export type QueueRead = { count: true } | { count: false; sort?: QueueSort; limit?: number };

export function parseQueueRead(params: {
  count: unknown;
  limit?: unknown;
  sort?: unknown;
}): QueueRead {
  const { count, limit, sort } = params;
  if (count !== undefined && count !== 'true' && count !== 'false') {
    throw new BadRequestException({ reason: 'invalid-count' });
  }
  if (count === 'true') {
    if (limit !== undefined || sort !== undefined) {
      throw new BadRequestException({ reason: 'invalid-count-query' });
    }
    return { count: true };
  }
  let parsedLimit: number | undefined;
  if (limit !== undefined) {
    if (typeof limit !== 'string' || !/^[0-9]{1,3}$/.test(limit)) {
      throw new BadRequestException({ reason: 'invalid-limit' });
    }
    parsedLimit = Number(limit);
    if (parsedLimit < 1 || parsedLimit > QUEUE_LIMIT_MAX) {
      throw new BadRequestException({ reason: 'invalid-limit' });
    }
  }
  let parsedSort: QueueSort | undefined;
  if (sort !== undefined) {
    const known = QUEUE_SORTS.find((word) => word === sort);
    if (known === undefined) {
      throw new BadRequestException({ reason: 'invalid-sort' });
    }
    parsedSort = known;
  }
  return {
    count: false,
    ...(parsedSort === undefined ? {} : { sort: parsedSort }),
    ...(parsedLimit === undefined ? {} : { limit: parsedLimit }),
  };
}
