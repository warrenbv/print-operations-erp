// Turns a line's tax status and typed jurisdiction into the treatment the API stores, or a sentence saying what is wrong.
// Each quote line carries a tax treatment: docs/product/requirements.md (R4). Jurisdiction keys are defined in packages/types/src/revenue.ts.
import {
  TAX_JURISDICTION_KEY_FORMAT,
  WASHINGTON_KEY_FORMAT,
  taxJurisdictionKeySchema,
  taxStateOf,
  type LineTaxTreatment,
  type TaxStatus,
} from '@erp/types';

/**
 * The treatment to store, or a sentence saying what is wrong with the jurisdiction typed.
 * A non-taxable line drops any jurisdiction. An `id_tax` line with no `ID` key typed is keyed `ID`.
 * A `wa_tax` line must name a `WA` key. Every key must pass `taxJurisdictionKeySchema`.
 */
export function treatmentWithJurisdiction(
  taxStatus: TaxStatus,
  jurisdiction: string | undefined,
): LineTaxTreatment | string {
  if (taxStatus === 'non_tax') {
    return { taxStatus };
  }
  const typed = jurisdiction?.trim() ?? '';
  const named = typed === '' ? undefined : taxStateOf(typed);
  if (named === null) {
    return (
      `tax jurisdiction "${typed}" names neither Idaho nor Washington. ` +
      `Use ${TAX_JURISDICTION_KEY_FORMAT}.`
    );
  }

  let key: string;
  if (taxStatus === 'id_tax') {
    key = named === 'ID' ? typed : 'ID';
  } else if (named === 'WA') {
    key = typed;
  } else {
    return `a Washington taxable line needs ${WASHINGTON_KEY_FORMAT}.`;
  }

  const keyed = taxJurisdictionKeySchema.safeParse(key);
  if (!keyed.success) {
    return (
      `tax jurisdiction "${typed}" is not one a tax rate can match. ` +
      `Use ${TAX_JURISDICTION_KEY_FORMAT}.`
    );
  }
  return { taxStatus, taxJurisdiction: keyed.data };
}
