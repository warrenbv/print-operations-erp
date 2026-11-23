// The buttons under an open line, and the warning that saving revokes a live price approval: docs/product/requirements.md (R7).
import { Button, COLOR, FONT_SIZE, LinkButton } from '@erp/ui';

export function ApprovalRevokeWarning() {
  return (
    <span style={{ color: COLOR.warning }}>
      Saving revokes the price approval. An approval is of specific numbers.
    </span>
  );
}

export function LineFormButtons({
  lineNumber,
  primary,
  remove,
  approvalLive,
}: {
  lineNumber: number;

  primary: boolean;
  remove: { kind: 'stored'; name: string } | { kind: 'new'; href: string };
  approvalLive: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <Button variant={primary ? 'primary' : 'secondary'}>Price line {lineNumber}</Button>
      {remove.kind === 'stored' ? (
        <Button name={remove.name} value="on">
          Remove line {lineNumber}
        </Button>
      ) : (
        <LinkButton href={remove.href}>Remove line {lineNumber}</LinkButton>
      )}
      <span style={{ fontSize: FONT_SIZE.sm, color: COLOR.muted }}>
        Pricing saves the line and shows it back as a row like line 1.
      </span>
      {approvalLive && <ApprovalRevokeWarning />}
    </div>
  );
}
