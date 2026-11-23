// The fictional business's name, telephone and sites, used on documents and in delivery labels.
import type { PostalAddress } from './postal-address';

export const BUSINESS_NAME = 'Demo Printworks';

export const BUSINESS_TELEPHONE = '208-555-0142';

export interface Site {
  readonly name: string;
  readonly address: Readonly<PostalAddress>;
}

export const PLANT_SITE: Site = {
  name: 'Demo Printworks plant',
  address: { line1: '100 Example Way', city: 'Example City', state: 'ID', postalCode: '83000' },
};

export const WAREHOUSE_SITE: Site = {
  name: 'Demo Printworks warehouse',
  address: { line1: '200 Sample Road', city: 'Sample City', state: 'WA', postalCode: '99000' },
};
