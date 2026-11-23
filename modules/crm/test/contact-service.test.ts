// ContactService on in-memory adapters: automatic mail roles, the reach rule, ownership checks and
// stale writes. The service is modules/crm/src/services/contact-service.ts.
import { MAIL_CONTACT_ROLES } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { InMemoryContactRepository } from '../src/adapters/in-memory/in-memory-contact-repository';
import { InMemoryCustomerRepository } from '../src/adapters/in-memory/in-memory-customer-repository';
import { AUTOMATIC_RECIPIENT_ACTOR, ContactService } from '../src/services/contact-service';
import type { Clock } from '../src/ports';
import { newCustomerInput } from './fixtures';

class MutableClock implements Clock {
  #current: Date;
  constructor(start: Date) {
    this.#current = start;
  }
  now(): Date {
    return this.#current;
  }
  advance(ms: number): void {
    this.#current = new Date(this.#current.getTime() + ms);
  }
}

const START = new Date('2026-08-03T09:00:00.000Z');

async function fixture(): Promise<{
  service: ContactService;
  customers: InMemoryCustomerRepository;
  contacts: InMemoryContactRepository;
  clock: MutableClock;
  customerId: string;
}> {
  const customers = new InMemoryCustomerRepository();
  const contacts = new InMemoryContactRepository();
  const clock = new MutableClock(START);
  const service = new ContactService({ contacts, customers, clock });
  const created = await customers.create(
    newCustomerInput({
      id: 'cust-1',
      name: 'Acme',
      createdAt: START,
      updatedAt: START,
    }),
  );
  return { service, customers, contacts, clock, customerId: created.id };
}

describe('the first contact takes the mail tags', () => {
  it('tags the first contact on an account where nobody holds a mail role', async () => {
    const { service, customerId, clock } = await fixture();

    const result = await service.create(customerId, { name: 'Jane', email: 'jane@example.test' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contact.roles.map((assignment) => assignment.role)).toEqual([
        ...MAIL_CONTACT_ROLES,
      ]);

      for (const assignment of result.contact.roles) {
        expect(assignment.setBy).toBe(AUTOMATIC_RECIPIENT_ACTOR);
        expect(assignment.setAt).toBe(clock.now().toISOString());
      }
    }
  });

  it('does not move the tags onto a later contact', async () => {
    const { service, customerId } = await fixture();
    const first = await service.create(customerId, { name: 'Jane', email: 'jane@example.test' });
    const second = await service.create(customerId, { name: 'Amy', email: 'amy@example.test' });

    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.contact.roles).toEqual([]);
    }
    if (first.ok) {
      const held = await service.listByCustomer(customerId);
      const still = held?.items.find((c) => c.id === first.contact.id);
      expect(still?.roles.map((assignment) => assignment.role)).toEqual([...MAIL_CONTACT_ROLES]);
    }
  });

  it('tags into an empty slot even when the account already has contacts', async () => {
    const { service, customerId } = await fixture();
    await service.create(customerId, { name: 'Phone Only', phone: '555-0157' });

    const second = await service.create(customerId, { name: 'Amy', email: 'amy@example.test' });

    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.contact.roles.map((assignment) => assignment.role)).toEqual([
        ...MAIL_CONTACT_ROLES,
      ]);
    }
  });

  it('does not tag a contact with no email, leaving the account honest', async () => {
    const { service, customerId } = await fixture();

    const result = await service.create(customerId, { name: 'Phone Only', phone: '555-0157' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contact.roles).toEqual([]);
    }
  });

  it('gives up the mail tags when the contact email is cleared', async () => {
    const { service, customerId } = await fixture();
    const created = await service.create(customerId, { name: 'Jane', email: 'jane@example.test' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const cleared = await service.update(
      customerId,
      created.contact.id,
      { email: null, lockVersion: created.contact.lockVersion },
      'dev-sales',
    );

    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.contact.email).toBeUndefined();
      expect(cleared.contact.roles).toEqual([]);

      expect([...cleared.rolesGivenUp].sort()).toEqual([...MAIL_CONTACT_ROLES].sort());
    }
  });

  it('leaves the tags alone when the address merely changes', async () => {
    const { service, customerId } = await fixture();
    const created = await service.create(customerId, { name: 'Jane', email: 'jane@example.test' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const moved = await service.update(
      customerId,
      created.contact.id,
      { email: 'jane.new@example.test', lockVersion: created.contact.lockVersion },
      'dev-sales',
    );

    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(moved.contact.email).toBe('jane.new@example.test');
      expect(moved.contact.roles.map((assignment) => assignment.role)).toEqual([
        ...MAIL_CONTACT_ROLES,
      ]);
    }
  });

  it('lets a person tag a second contact, and both keep the tag', async () => {
    const { service, customerId } = await fixture();
    const first = await service.create(customerId, { name: 'Jane', email: 'jane@example.test' });
    const second = await service.create(customerId, { name: 'Amy', email: 'amy@example.test' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const tagged = await service.update(
      customerId,
      second.contact.id,
      { roles: [...MAIL_CONTACT_ROLES], lockVersion: second.contact.lockVersion },
      'dev-sales',
    );

    expect(tagged.ok).toBe(true);
    if (tagged.ok) {
      expect(tagged.contact.roles.map((assignment) => assignment.role)).toEqual([
        ...MAIL_CONTACT_ROLES,
      ]);

      expect(tagged.contact.roles[0]?.setBy).toBe('dev-sales');
    }
    const held = await service.listByCustomer(customerId);
    const confirmationHolders =
      held?.items.filter((c) =>
        c.roles.some((assignment) => assignment.role === 'order_confirmation'),
      ) ?? [];
    expect(confirmationHolders).toHaveLength(2);

    expect(
      held?.items
        .find((c) => c.id === first.contact.id)
        ?.roles.every((assignment) => assignment.setBy === AUTOMATIC_RECIPIENT_ACTOR),
    ).toBe(true);
  });
});

describe('ContactService.create', () => {
  it('returns customer-not-found when the parent customer does not exist', async () => {
    const { service } = await fixture();
    const result = await service.create('unknown-customer', { name: 'Jane' });
    expect(result).toEqual({ ok: false, reason: 'customer-not-found' });
  });

  it('mints an id + timestamps and attaches to the customer', async () => {
    const { service, customerId, clock } = await fixture();
    const result = await service.create(customerId, { name: 'Jane' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contact.id).toBeTruthy();
      expect(result.contact.customerId).toBe(customerId);
      expect(result.contact.createdAt).toBe(clock.now().toISOString());
    }
  });
});

describe('ContactService.listByCustomer', () => {
  it('returns null when the customer does not exist', async () => {
    const { service } = await fixture();
    expect(await service.listByCustomer('unknown-customer')).toBeNull();
  });

  it('returns the contacts wrapped in { items }', async () => {
    const { service, customerId } = await fixture();
    await service.create(customerId, { name: 'Jane' });
    await service.create(customerId, { name: 'Amy' });
    const list = await service.listByCustomer(customerId);
    expect(list?.items.map((c) => c.name)).toEqual(['Amy', 'Jane']);
  });
});

describe('ContactService.update', () => {
  it('returns contact-not-found when the contact does not exist', async () => {
    const { service, customerId } = await fixture();
    const result = await service.update(
      customerId,
      'unknown-contact',
      { name: 'x', lockVersion: 1 },
      'dev-sales',
    );
    expect(result).toEqual({ ok: false, reason: 'contact-not-found' });
  });

  it("returns wrong-customer when the URL customerId does not match the contact's owner", async () => {
    const { service, customers, customerId } = await fixture();
    const created = await service.create(customerId, { name: 'Jane' });
    if (!created.ok) throw new Error('setup failed');

    const other = await customers.create(
      newCustomerInput({
        id: 'cust-other',
        name: 'Other Corp',
        createdAt: START,
        updatedAt: START,
      }),
    );
    const result = await service.update(
      other.id,
      created.contact.id,
      { name: 'Renamed', lockVersion: 1 },
      'dev-sales',
    );
    expect(result).toEqual({ ok: false, reason: 'wrong-customer' });
  });

  it('applies the patch when customer and contact match', async () => {
    const { service, customerId, clock } = await fixture();
    const created = await service.create(customerId, { name: 'Jane' });
    if (!created.ok) throw new Error('setup failed');
    clock.advance(60_000);
    const result = await service.update(
      customerId,
      created.contact.id,
      { email: 'jane@acme.example', lockVersion: created.contact.lockVersion },
      'dev-sales',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contact.email).toBe('jane@acme.example');
      expect(result.contact.updatedAt).toBe(clock.now().toISOString());
    }
  });

  it('refuses a patch written against a generation that has moved on', async () => {
    const { service, customerId } = await fixture();
    const created = await service.create(customerId, { name: 'Jane' });
    if (!created.ok) throw new Error('setup failed');
    const first = await service.update(
      customerId,
      created.contact.id,
      { name: 'One', lockVersion: created.contact.lockVersion },
      'dev-sales',
    );
    expect(first.ok).toBe(true);

    await expect(
      service.update(
        customerId,
        created.contact.id,
        { name: 'Two', lockVersion: created.contact.lockVersion },
        'dev-sales',
      ),
    ).rejects.toMatchObject({ name: 'StaleAggregateError' });
  });
});

describe('a name or an email address', () => {
  it('adds a contact that is an email address alone, and tags it as the first', async () => {
    const { service, customerId } = await fixture();
    const result = await service.create(customerId, { email: 'ap@example.test' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contact.name).toBeNull();
    expect(result.contact.email).toBe('ap@example.test');
    expect(result.contact.roles.map((assignment) => assignment.role)).toEqual([
      ...MAIL_CONTACT_ROLES,
    ]);
  });

  it('refuses a contact with neither, before it reads the customer', async () => {
    const { service } = await fixture();
    const result = await service.create('no-such-customer', { phone: '360 555 0187' });
    expect(result).toEqual({ ok: false, reason: 'contact-needs-name-or-email' });
  });

  it('allows clearing the name of a contact with an address', async () => {
    const { service, customerId } = await fixture();
    const created = await service.create(customerId, { name: 'AP', email: 'ap@example.test' });
    if (!created.ok) throw new Error('setup failed');
    const result = await service.update(
      customerId,
      created.contact.id,
      { name: null, lockVersion: created.contact.lockVersion },
      'dev-sales',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contact.name).toBeNull();
    expect(result.contact.email).toBe('ap@example.test');
  });

  it('refuses clearing the address of a contact with no name, and changes nothing', async () => {
    const { service, contacts, customerId } = await fixture();
    const created = await service.create(customerId, { email: 'ap@example.test' });
    if (!created.ok) throw new Error('setup failed');
    const result = await service.update(
      customerId,
      created.contact.id,
      { email: null, lockVersion: created.contact.lockVersion },
      'dev-sales',
    );

    expect(result).toEqual({ ok: false, reason: 'contact-needs-name-or-email' });
    const after = await contacts.findById(created.contact.id);
    expect(after?.email).toBe('ap@example.test');
    expect(after?.lockVersion).toBe(created.contact.lockVersion);
  });

  it('refuses clearing both in one patch', async () => {
    const { service, customerId } = await fixture();
    const created = await service.create(customerId, { name: 'AP', email: 'ap@example.test' });
    if (!created.ok) throw new Error('setup failed');
    const result = await service.update(
      customerId,
      created.contact.id,
      { name: null, email: null, lockVersion: created.contact.lockVersion },
      'dev-sales',
    );
    expect(result).toEqual({ ok: false, reason: 'contact-needs-name-or-email' });
  });

  it('allows naming a contact that had only an address', async () => {
    const { service, customerId } = await fixture();
    const created = await service.create(customerId, { email: 'ap@example.test' });
    if (!created.ok) throw new Error('setup failed');
    const result = await service.update(
      customerId,
      created.contact.id,
      { name: 'Accounts Payable', email: null, lockVersion: created.contact.lockVersion },
      'dev-sales',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contact.name).toBe('Accounts Payable');

    expect(result.rolesGivenUp).toEqual([...MAIL_CONTACT_ROLES]);
  });
});

describe('contact roles', () => {
  it('returns BOTH holders when two contacts hold quote', async () => {
    const { service, customerId, clock } = await fixture();
    const first = await service.create(customerId, { name: 'Jane', email: 'jane@example.test' });
    clock.advance(60_000);
    const second = await service.create(customerId, { name: 'Amy', email: 'amy@example.test' });
    if (!first.ok || !second.ok) throw new Error('setup failed');

    await service.update(
      customerId,
      second.contact.id,
      { roles: ['quote'], lockVersion: second.contact.lockVersion },
      'dev-sales',
    );

    const listed = await service.listByCustomer(customerId);
    const quoteHolders =
      listed?.items.filter((c) => c.roles.some((role) => role.role === 'quote')) ?? [];
    expect(quoteHolders.map((c) => c.id).sort()).toEqual(
      [first.contact.id, second.contact.id].sort(),
    );

    expect(
      quoteHolders
        .find((c) => c.id === first.contact.id)
        ?.roles.find((role) => role.role === 'quote')?.setBy,
    ).toBe(AUTOMATIC_RECIPIENT_ACTOR);
    expect(
      quoteHolders
        .find((c) => c.id === second.contact.id)
        ?.roles.find((role) => role.role === 'quote')?.setBy,
    ).toBe('dev-sales');
  });

  it('stamps a new role with the actor and the clock', async () => {
    const { service, customerId, clock } = await fixture();
    const created = await service.create(customerId, { name: 'Foreman', phone: '555-0157' });
    if (!created.ok) throw new Error('setup failed');
    clock.advance(60_000);

    const tagged = await service.update(
      customerId,
      created.contact.id,
      { roles: ['production'], lockVersion: created.contact.lockVersion },
      'dev-sales',
    );

    expect(tagged.ok).toBe(true);
    if (tagged.ok) {
      expect(tagged.contact.roles).toEqual([
        { role: 'production', setBy: 'dev-sales', setAt: clock.now().toISOString() },
      ]);
      expect(tagged.rolesGivenUp).toEqual([]);
    }
  });

  it('keeps the provenance of a role already held when an unrelated field changes', async () => {
    const { service, customerId, clock } = await fixture();
    const created = await service.create(customerId, { name: 'Jane', email: 'jane@example.test' });
    if (!created.ok) throw new Error('setup failed');
    const stamped = created.contact.roles[0]?.setAt;
    clock.advance(60_000);

    const renamed = await service.update(
      customerId,
      created.contact.id,
      { name: 'Alex Example', lockVersion: created.contact.lockVersion },
      'dev-sales',
    );

    expect(renamed.ok).toBe(true);
    if (renamed.ok) {
      expect(renamed.contact.roles[0]?.setBy).toBe(AUTOMATIC_RECIPIENT_ACTOR);
      expect(renamed.contact.roles[0]?.setAt).toBe(stamped);
    }
  });

  it('gives up the tags the address no longer supports, and names them', async () => {
    const { service, customerId } = await fixture();
    const created = await service.create(customerId, { name: 'Jane', email: 'jane@example.test' });
    if (!created.ok) throw new Error('setup failed');
    const tagged = await service.update(
      customerId,
      created.contact.id,
      { roles: ['quote', 'production'], lockVersion: created.contact.lockVersion },
      'dev-sales',
    );
    if (!tagged.ok) throw new Error('setup failed');

    const cleared = await service.update(
      customerId,
      created.contact.id,
      { email: null, lockVersion: tagged.contact.lockVersion },
      'dev-sales',
    );

    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.contact.roles).toEqual([]);
      expect(cleared.rolesGivenUp).toEqual(['quote', 'production']);
    }
  });

  it('keeps production when only the mail address goes', async () => {
    const { service, customerId } = await fixture();
    const created = await service.create(customerId, {
      name: 'Foreman',
      email: 'foreman@example.test',
      phone: '555-0157',
    });
    if (!created.ok) throw new Error('setup failed');
    const tagged = await service.update(
      customerId,
      created.contact.id,
      { roles: ['order_confirmation', 'production'], lockVersion: created.contact.lockVersion },
      'dev-sales',
    );
    if (!tagged.ok) throw new Error('setup failed');

    const cleared = await service.update(
      customerId,
      created.contact.id,
      { email: null, lockVersion: tagged.contact.lockVersion },
      'dev-sales',
    );

    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.contact.roles.map((role) => role.role)).toEqual(['production']);
      expect(cleared.rolesGivenUp).toEqual(['order_confirmation']);
    }
  });

  it('refuses a tag the contact could never carry, rather than dropping it', async () => {
    const { service, customerId } = await fixture();
    const created = await service.create(customerId, { name: 'Foreman', phone: '555-0157' });
    if (!created.ok) throw new Error('setup failed');

    const refused = await service.update(
      customerId,
      created.contact.id,
      { roles: ['order_confirmation'], lockVersion: created.contact.lockVersion },
      'dev-sales',
    );

    expect(refused).toEqual({
      ok: false,
      reason: 'contact-role-unreachable',
      roles: ['order_confirmation'],
    });
  });

  it('grants a tag the same patch makes reachable', async () => {
    const { service, customerId } = await fixture();
    const created = await service.create(customerId, { name: 'Foreman', phone: '555-0157' });
    if (!created.ok) throw new Error('setup failed');

    const tagged = await service.update(
      customerId,
      created.contact.id,
      {
        email: 'foreman@example.test',
        roles: ['order_confirmation'],
        lockVersion: created.contact.lockVersion,
      },
      'dev-sales',
    );

    expect(tagged.ok).toBe(true);
    if (tagged.ok) {
      expect(tagged.contact.roles.map((role) => role.role)).toEqual(['order_confirmation']);
    }
  });

  it('replaces the set, so unticking everything leaves nothing', async () => {
    const { service, customerId } = await fixture();
    const created = await service.create(customerId, { name: 'Jane', email: 'jane@example.test' });
    if (!created.ok) throw new Error('setup failed');

    const cleared = await service.update(
      customerId,
      created.contact.id,
      { roles: [], lockVersion: created.contact.lockVersion },
      'dev-sales',
    );

    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.contact.roles).toEqual([]);

      expect(cleared.rolesGivenUp).toEqual([]);
    }
  });

  it('gives the first emailable contact its tags even when a phone-only one is already tagged', async () => {
    const { service, customerId } = await fixture();
    const foreman = await service.create(customerId, { name: 'Foreman', phone: '555-0157' });
    if (!foreman.ok) throw new Error('setup failed');
    await service.update(
      customerId,
      foreman.contact.id,
      { roles: ['production'], lockVersion: foreman.contact.lockVersion },
      'dev-sales',
    );

    const buyer = await service.create(customerId, { name: 'Amy', email: 'amy@example.test' });

    expect(buyer.ok).toBe(true);
    if (buyer.ok) {
      expect(buyer.contact.roles.map((role) => role.role)).toEqual(['quote', 'order_confirmation']);
    }
  });
});

describe('ContactService.delete', () => {
  it('returns wrong-customer when the contact is owned by another customer', async () => {
    const { service, customers, customerId } = await fixture();
    const created = await service.create(customerId, { name: 'Jane' });
    if (!created.ok) throw new Error('setup failed');
    const other = await customers.create(
      newCustomerInput({
        id: 'cust-other',
        name: 'Other Corp',
        createdAt: START,
        updatedAt: START,
      }),
    );
    const result = await service.delete(other.id, created.contact.id, created.contact.lockVersion);
    expect(result).toEqual({ ok: false, reason: 'wrong-customer' });
  });

  it('removes the contact when customer and contact match', async () => {
    const { service, customerId, contacts } = await fixture();
    const created = await service.create(customerId, { name: 'Jane' });
    if (!created.ok) throw new Error('setup failed');
    const result = await service.delete(
      customerId,
      created.contact.id,
      created.contact.lockVersion,
    );
    expect(result).toEqual({ ok: true });
    expect(await contacts.findById(created.contact.id)).toBeNull();
  });
});
