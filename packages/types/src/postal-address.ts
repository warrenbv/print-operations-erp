// The postal address shared by billing, shipping and line delivery addresses, and the lines it prints as.
import { z } from 'zod';

export const stateCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, { error: 'state must be a two-letter code, e.g. WA' });

export const postalCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{5}(-\d{4})?$/, { error: 'postal code must be 12345 or 12345-6789' });

export const postalAddressSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().min(1).max(200).optional(),
  city: z.string().trim().min(1).max(120),
  state: stateCodeSchema,
  postalCode: postalCodeSchema,
});

export type PostalAddress = z.infer<typeof postalAddressSchema>;

export function streetLines(address: PostalAddress): string[] {
  return [
    address.line1,
    ...(address.line2 === undefined ? [] : [address.line2]),
    `${address.city}, ${address.state} ${address.postalCode}`,
  ];
}

export function addressLines(address: PostalAddress): string[] {
  return [...(address.name === undefined ? [] : [address.name]), ...streetLines(address)];
}
