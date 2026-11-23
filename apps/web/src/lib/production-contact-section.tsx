// The Production contact row on the order page: who the floor calls at the customer, or where to tag one.
// Only a reader allowed to tag contacts is asked to do it. Others are told Sales does.
import type { Contact } from '@erp/types';
import { COLOR } from '@erp/ui';

import { productionContactWords } from './production-contact';

export function ProductionContactRow({
  customerId,
  contacts,
  mayTag,
}: {
  customerId: string;
  contacts: readonly Contact[];

  mayTag: boolean;
}) {
  const customerHref = `/crm/customers/${encodeURIComponent(customerId)}`;
  return (
    <>
      <dt>Production contact</dt>
      <dd>
        {contacts.length === 0 ? (
          <span style={{ color: COLOR.muted }}>
            No production contact on this account.{' '}
            {mayTag ? (
              <>
                Tag one on{' '}
                <a href={customerHref} style={{ color: COLOR.accent }}>
                  the customer
                </a>{' '}
                so the floor knows who to call.
              </>
            ) : (
              <>
                Sales tags one on{' '}
                <a href={customerHref} style={{ color: COLOR.accent }}>
                  the customer
                </a>
                .
              </>
            )}
          </span>
        ) : (
          contacts.map(productionContactWords).join('; ')
        )}
      </dd>
    </>
  );
}
