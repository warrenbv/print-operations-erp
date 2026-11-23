// Tests the Production contact selection and how one prints.
import type { Contact, ContactRole } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { productionContactWords, productionContacts } from './production-contact';

function contact(name: string, roles: readonly ContactRole[]): Contact {
  return {
    id: `contact-${name.toLowerCase()}`,
    customerId: 'customer-1',
    name,
    phone: '253-555-0148',
    createdAt: '2026-09-21T00:00:00.000Z',
    updatedAt: '2026-09-21T00:00:00.000Z',
    lockVersion: 1,
    roles: roles.map((role) => ({
      role,
      setBy: 'dev-sales',
      setAt: '2026-09-21T00:00:00.000Z',
    })),
  };
}

describe('productionContacts', () => {
  it('keeps the contacts tagged production', () => {
    const foreman = contact('Foreman', ['production']);
    expect(productionContacts([foreman])).toEqual([foreman]);
  });

  it('leaves out a contact holding only mail tags', () => {
    const clerk = contact('Clerk', ['quote', 'order_confirmation']);
    expect(productionContacts([clerk])).toEqual([]);
  });

  it('leaves out a contact nobody has tagged', () => {
    expect(productionContacts([contact('Untagged', [])])).toEqual([]);
  });

  it('keeps a contact who holds the tag among others', () => {
    const buyer = contact('Buyer', ['quote', 'production']);
    expect(productionContacts([buyer])).toEqual([buyer]);
  });

  it('answers in the order it was given, which is the CRM order', () => {
    const contacts = [
      contact('Abe', ['production']),
      contact('Bea', ['order_confirmation']),
      contact('Cal', ['production']),
    ];
    expect(productionContacts(contacts).map((found) => found.name)).toEqual(['Abe', 'Cal']);
  });

  it('answers empty for an account with no contacts', () => {
    expect(productionContacts([])).toEqual([]);
  });
});

describe('productionContactWords', () => {
  it('reads the name, the phone, then the address', () => {
    const foreman = { ...contact('Foreman', ['production']), email: 'fixture-35@example.test' };
    expect(productionContactWords(foreman)).toBe(
      'Foreman · 253-555-0148 · fixture-35@example.test',
    );
  });

  it('leads with the address of a contact with no name, printed once', () => {
    const mailbox = {
      ...contact('mailbox', ['production']),
      name: null,
      email: 'fixture-35@example.test',
    };
    expect(productionContactWords(mailbox)).toBe('fixture-35@example.test · 253-555-0148');
  });
});
