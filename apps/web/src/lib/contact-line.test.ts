// Tests when a contact's email prints beside its label.
import { describe, expect, it } from 'vitest';

import { contactLine } from './contact-line';

describe('contactLine', () => {
  it('leads with the name and puts the address beside it', () => {
    expect(contactLine({ name: 'Pat Example', email: 'fixture-33@example.test' })).toEqual({
      label: 'Pat Example',
      email: 'fixture-33@example.test',
    });
  });

  it('leads with the address of a contact with no name, and prints it once', () => {
    expect(contactLine({ name: null, email: 'fixture-09@example.test' })).toEqual({
      label: 'fixture-09@example.test',
    });
  });

  it('is the name alone for a contact with no address', () => {
    expect(contactLine({ name: 'Pat Example' })).toEqual({ label: 'Pat Example' });
  });
});
