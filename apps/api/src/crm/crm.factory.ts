// The crm composition root: chooses the customer, contact and defaults stores and builds the three services.
// Storage follows apps/api/src/config/persistence-guard.ts: docs/decisions/007-persistence-switch-at-the-composition-root.md.
import { createPool } from '@erp/db';
import {
  ContactService,
  CustomerDefaultsService,
  CustomerService,
  DrizzleContactRepository,
  DrizzleCustomerDefaultsRepository,
  DrizzleCustomerRepository,
  InMemoryContactRepository,
  InMemoryCustomerDefaultsRepository,
  InMemoryCustomerRepository,
  createCrmDb,
  type ContactRepository,
  type CustomerDefaultsRepository,
  type CustomerRepository,
} from '@erp/crm';
import { resolvePersistenceModeFromEnv } from '../config/persistence-guard';
import { apiClock } from '../test-clock';

export const CRM_STORES = Symbol('CRM_STORES');

export interface CrmStores {
  customers: CustomerRepository;
  contacts: ContactRepository;

  customerDefaults: CustomerDefaultsRepository;

  close(): Promise<void>;
}

export async function createCrmStores(): Promise<CrmStores> {
  const persistence = resolvePersistenceModeFromEnv(process.env);

  if (persistence === 'memory') {
    return {
      customers: new InMemoryCustomerRepository(),
      contacts: new InMemoryContactRepository(),
      customerDefaults: new InMemoryCustomerDefaultsRepository(),
      close: async () => {},
    };
  }

  const pool = createPool();
  const db = createCrmDb(pool);
  return {
    customers: new DrizzleCustomerRepository(db),
    contacts: new DrizzleContactRepository(db),
    customerDefaults: new DrizzleCustomerDefaultsRepository(db),
    close: () => pool.end(),
  };
}

export async function createCustomerService(stores: CrmStores): Promise<CustomerService> {
  return new CustomerService({ customers: stores.customers, clock: apiClock });
}

export async function createContactService(stores: CrmStores): Promise<ContactService> {
  return new ContactService({
    contacts: stores.contacts,
    customers: stores.customers,
    clock: apiClock,
  });
}

export async function createCustomerDefaultsService(
  stores: CrmStores,
): Promise<CustomerDefaultsService> {
  return new CustomerDefaultsService({
    defaults: stores.customerDefaults,
    customers: stores.customers,
    clock: apiClock,
  });
}
