// A sales rep's name, marked when the stored username no longer resolves or the person is no longer offered as a rep.
// Resolution is in apps/web/src/lib/sales-reps.ts.
import { salesRepLabel, type ResolvedSalesRep } from '@erp/types';
import { COLOR } from '@erp/ui';

export function SalesRepName({ rep }: { rep: ResolvedSalesRep }) {
  return (
    <>
      {salesRepLabel(rep)}
      {rep.displayName === undefined ? (
        <span style={{ color: COLOR.muted }}> (as stored)</span>
      ) : rep.offerable ? null : (
        <span style={{ color: COLOR.muted }}> (no longer in sales)</span>
      )}
    </>
  );
}
