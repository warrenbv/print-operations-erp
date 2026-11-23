// The CRM module's public surface. Only apps/api imports it: modules/crm/README.md.
export { CustomerService, type CustomerServiceOptions } from './services/customer-service';
export {
  ContactService,
  type ContactDeleteResult,
  type ContactServiceOptions,
  type ContactUpdateResult,
  type ContactWriteResult,
} from './services/contact-service';
export {
  CustomerDefaultsService,
  type AgreedPriceWriteResult,
  type CustomerDefaultsServiceOptions,
  type CustomerDefaultsWriteResult,
} from './services/customer-defaults-service';

export {
  ContactCustomerNotFoundError,
  CustomerDefaultsCustomerNotFoundError,
  DuplicateLegacyAccountNumberError,
  type AgreedPriceWrite,
  type Clock,
  type ContactPatch,
  type ContactRepository,
  type ContactRoleRow,
  type CustomerDefaultsRepository,
  type CustomerDefaultsWrite,
  type CustomerNamePage,
  type CustomerPatch,
  type CustomerRepository,
  type CustomerSearchPage,
  type CustomerSearchParams,
  type NewContact,
  type NewCustomer,
} from './ports';

export { systemClock } from './adapters/system-clock';
export { InMemoryCustomerRepository } from './adapters/in-memory/in-memory-customer-repository';
export { InMemoryContactRepository } from './adapters/in-memory/in-memory-contact-repository';
export { InMemoryCustomerDefaultsRepository } from './adapters/in-memory/in-memory-customer-defaults-repository';

export { createCrmDb, type CrmDb } from './data/crm-db';
export { DrizzleCustomerRepository } from './adapters/drizzle/drizzle-customer-repository';
export { DrizzleContactRepository } from './adapters/drizzle/drizzle-contact-repository';
export { DrizzleCustomerDefaultsRepository } from './adapters/drizzle/drizzle-customer-defaults-repository';
