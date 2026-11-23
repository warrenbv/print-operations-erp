// The parts a tax rate is made of, as table cells, with a dash where a part is not recorded.
import { formatRatePercent, type TaxRate } from '@erp/types';
import { COLOR, QueueCell, type QueueColumn } from '@erp/ui';

export const RATE_PART_COLUMNS: readonly QueueColumn[] = [
  { label: 'State', num: true },
  { label: 'Local', num: true },
  { label: 'RTA', num: true },
];

export function RatePartCells({
  row,
}: {
  row: Pick<TaxRate, 'stateRate' | 'localRate' | 'rtaRate'>;
}) {
  return (
    <>
      <PartCell ratio={row.stateRate} />
      <PartCell ratio={row.localRate} />
      <PartCell ratio={row.rtaRate} />
    </>
  );
}

function PartCell({ ratio }: { ratio: string | undefined }) {
  return (
    <QueueCell num>
      {ratio === undefined ? (
        <span style={{ color: COLOR.muted }}>&mdash;</span>
      ) : (
        formatRatePercent(ratio)
      )}
    </QueueCell>
  );
}
