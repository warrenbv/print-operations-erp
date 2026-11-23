// The tax treatment a new line starts on, from the customer record: docs/product/requirements.md (R4).
import { taxJurisdictionKeySchema, type Customer, type TaxStatus } from '@erp/types';

export function seedTaxTreatment(customer: Customer | null): {
  taxStatus: TaxStatus | '';
  taxJurisdiction: string;
} {
  if (customer === null) {
    return { taxStatus: '', taxJurisdiction: '' };
  }
  // Exempt and reseller customers start non-taxable. Only the customer page changes that.
  if (customer.taxExempt || customer.reseller) {
    return { taxStatus: 'non_tax', taxJurisdiction: '' };
  }
  const jurisdiction = customer.taxJurisdiction;
  if (jurisdiction === undefined) {
    return { taxStatus: '', taxJurisdiction: '' };
  }

  const taxable = taxableStatusFor(jurisdiction);
  if (taxable === undefined) {
    return { taxStatus: 'non_tax', taxJurisdiction: '' };
  }

  const keyed = taxJurisdictionKeySchema.safeParse(jurisdiction);
  return { taxStatus: taxable, taxJurisdiction: keyed.success ? keyed.data : '' };
}

/**
 * The taxable treatment for a jurisdiction code, read from the state at its start. A state with no
 * treatment of its own gives undefined, and the line starts non-taxable.
 */
export function taxableStatusFor(jurisdiction: string): TaxStatus | undefined {
  const state = jurisdiction
    .trim()
    .toUpperCase()
    .split(/[^A-Z]/)[0];
  if (state === 'ID') {
    return 'id_tax';
  }
  if (state === 'WA') {
    return 'wa_tax';
  }
  return undefined;
}
