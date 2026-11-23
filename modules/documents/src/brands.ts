// The letterhead and footer printed on every document. Templates receive a `Brand` and never name the
// business themselves, which modules/documents/test/brands.test.ts enforces.
import { BUSINESS_NAME, BUSINESS_TELEPHONE, PLANT_SITE, streetLines } from '@erp/types';

import type { LetterheadBlock } from './document-model';

export interface Brand {
  readonly name: string;

  readonly letterheadNameLines: readonly string[];

  readonly postalLines: readonly string[];

  readonly telephone: string;
}

export const DEMO_BRAND: Brand = {
  name: BUSINESS_NAME,
  letterheadNameLines: ['DEMO', 'PRINTWORKS'],
  postalLines: streetLines(PLANT_SITE.address).map((line) => line.toUpperCase()),
  telephone: BUSINESS_TELEPHONE,
};

const FOOTER_SEPARATOR = ' · ';

export function letterheadBlock(brand: Brand): LetterheadBlock {
  return {
    type: 'letterhead',
    nameLines: brand.letterheadNameLines,
    detailLines: [...brand.postalLines, `TELEPHONE ${brand.telephone}`],
  };
}

export function brandShortLine(brand: Brand): string {
  return [brand.name, brand.telephone].join(FOOTER_SEPARATOR);
}

export function brandedFooter(brand: Brand, identifier?: string): string {
  return identifier === undefined
    ? brandShortLine(brand)
    : `${identifier}${FOOTER_SEPARATOR}${brandShortLine(brand)}`;
}
