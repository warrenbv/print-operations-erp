// The customer's own part number and description for a line, shown beside the paper spec.
// The limits match the customer_part_number and customer_description checks in the quoting and orders baselines
// under infra/db/migrations/.
import { z } from 'zod';

export const CUSTOMER_PART_NUMBER_MAX = 40;

export const CUSTOMER_DESCRIPTION_MAX = 120;

export const customerPartNumberSchema = z.string().trim().min(1).max(CUSTOMER_PART_NUMBER_MAX);

export const customerDescriptionSchema = z.string().trim().min(1).max(CUSTOMER_DESCRIPTION_MAX);

export function withCustomerDescription(
  spec: string,
  line: { customerDescription?: string | undefined },
): string {
  return line.customerDescription === undefined ? spec : `${line.customerDescription} · ${spec}`;
}
