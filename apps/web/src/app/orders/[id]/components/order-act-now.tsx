// The Act now panel on the order page. A converted order shows the confirm form to a reader who may confirm,
// and the desk it waits on to everyone else: docs/product/requirements.md (R11, R12).
import { type OrderWithLines } from '@erp/types';
import { ActNow, COLOR, GateList } from '@erp/ui';

import type { RecordAct } from '../../../../lib/record/lifecycle';
import { ConfirmForm } from './lifecycle-actions';

export function OrderActNow({
  order,
  act,
  confirm,
  waiting,
  fieldError,
}: {
  order: Pick<OrderWithLines, 'id' | 'lockVersion' | 'status' | 'requestedDate'>;
  act: RecordAct;

  confirm: { value?: number; hint: string };

  waiting: string | undefined;

  fieldError: string | undefined;
}) {
  if (order.status === 'converted' && act.tone === 'act') {
    return (
      <ActNow tone="act" id="confirmation" title="Confirm the order" who={act.who}>
        <GateList gates={act.gates ?? []} />
        <ConfirmForm
          order={order}
          defaultDays={confirm.value}
          hint={confirm.hint}
          fieldError={fieldError}
        />
      </ActNow>
    );
  }

  if (order.status === 'converted') {
    return (
      <ActNow tone="waiting" id="confirmation" title={act.title} who={act.who}>
        {waiting !== undefined && <p style={{ margin: 0 }}>{waiting}</p>}
        {act.link !== undefined && (
          <p style={{ margin: 0 }}>
            <a href={act.link.href} style={{ color: COLOR.accent }}>
              {act.link.label}
            </a>
          </p>
        )}
      </ActNow>
    );
  }

  return (
    <ActNow tone="done" label={act.title}>
      <p style={{ margin: 0 }}>{act.who}</p>
    </ActNow>
  );
}
