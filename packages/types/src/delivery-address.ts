// The delivery address a quote or order line carries: docs/product/requirements.md (R4).
import { postalAddressSchema, type PostalAddress } from './postal-address';

export const deliveryAddressSchema = postalAddressSchema;

export type DeliveryAddress = PostalAddress;

export { postalCodeSchema, stateCodeSchema } from './postal-address';
