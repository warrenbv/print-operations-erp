// Loads how many rolls of each width fit on a pallet for one product family, narrowest first.
import { palletFitListResponseSchema, type PalletFit, type ProductFamily } from '@erp/types';

import { fetchParsed } from '../../../lib/fetch-parsed';

export async function loadPalletFits(family: ProductFamily): Promise<PalletFit[]> {
  const { items } = await fetchParsed(
    `/quoting/pallet-fits?family=${encodeURIComponent(family)}`,
    palletFitListResponseSchema,
  );
  return [...items].sort((a, b) => a.rollWidthIn - b.rollWidthIn);
}
