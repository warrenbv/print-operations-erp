// Display labels for a line's revenue category and tax status.
// Each quote line carries a tax treatment: docs/product/requirements.md (R4).
import type { RevenueCategory, TaxStatus } from '@erp/types';

export const REVENUE_CATEGORY_LABELS: Record<RevenueCategory, string> = {
  print: 'Print & converting',
  label: 'Label converting',
  freight: 'Freight',
  design: 'Design',
};

export const TAX_STATUS_LABELS: Record<TaxStatus, string> = {
  id_tax: 'Idaho taxable',
  wa_tax: 'Washington taxable',
  non_tax: 'Non-taxable',
};
