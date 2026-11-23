// Parses the sales-rep filter on list routes. An empty or repeated value is refused rather than read as every rep.
// The value is not checked against current users, because a stored quote can carry a rep no current user matches.
import { BadRequestException } from '@nestjs/common';

export function parseSalesRepFilter(salesRep: unknown): string | undefined {
  if (salesRep === undefined) {
    return undefined;
  }
  if (typeof salesRep !== 'string') {
    throw new BadRequestException({ reason: 'invalid-sales-rep' });
  }

  const trimmed = salesRep.trim();
  if (trimmed === '') {
    throw new BadRequestException({ reason: 'empty-sales-rep' });
  }
  return trimmed;
}
