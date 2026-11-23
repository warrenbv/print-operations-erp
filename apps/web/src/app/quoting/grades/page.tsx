// The paper grade catalog, the cost inputs a quote line is priced from: docs/product/requirements.md (R3).
// The Billing Manager edits it (docs/product/roles.md). Others see it read only.
// Form rows are read by apps/web/src/app/quoting/grades/actions.ts.
import {
  DEFAULT_REAM_AREA_DIVISOR,
  PRICING_CONFIG_WRITE_ROLES,
  PRODUCT_FAMILIES,
  formatMoney,
  formatWidthIn,
  type Grade,
  type GradeFootage,
  type GradeWidth,
  type ProductFamily,
} from '@erp/types';
import {
  Button,
  CheckboxLabel,
  COLOR,
  DATA_LINE_STYLE,
  DataLine,
  EmptyState,
  ErrorBanner,
  Field,
  FieldLabel,
  FieldRow,
  Fold,
  FONT_SIZE,
  Hint,
  Input,
  InfoBanner,
  PageLede,
  PageShell,
  QueueCell,
  QueueTable,
  Section,
  SectionNote,
  Select,
  SPACE,
} from '@erp/ui';

import { onlyDesk } from '../../../lib/helptext';
import { loadMe } from '../../../lib/load-me';
import { PRODUCT_FAMILY_LABELS } from '../format';
import { loadGrades } from '../load-grades';
import { formatTimestamp, isUnsetTimestamp } from '../../../lib/dates';
import { createGradeAction, updateGradeAction } from './actions';
import { widthListText } from './collect-widths';
import { loadPalletFits } from './load-pallet-fits';

export const metadata = { title: 'Paper grades' };

const COLUMNS = [
  { label: 'Grade' },
  { label: 'Basis weight (lb)', num: true },
  { label: 'Ream area divisor', num: true },
  { label: 'Paper cost ($/tonne)', num: true },
  { label: 'Footage variants' },
  { label: 'Stock widths' },
  { label: 'Last changed' },
] as const;

interface PageProps {
  searchParams: Promise<{ error?: string; notice?: string }>;
}

export default async function GradeCatalogPage({ searchParams }: PageProps) {
  const { error, notice } = await searchParams;

  const me = await loadMe();
  if (me === null) {
    return (
      <PageShell>
        <h1>Paper grades</h1>
        <p>
          <a href="/login" style={{ color: COLOR.accent }}>
            Sign in
          </a>{' '}
          to view this page.
        </p>
      </PageShell>
    );
  }

  const [grades, fitsByFamily] = await Promise.all([
    loadGrades(),

    Promise.all(
      PRODUCT_FAMILIES.map(async (family) => [family, await loadPalletFits(family)] as const),
    ),
  ]);
  const familyFits = new Map(fitsByFamily);
  // Hiding the form only spares other roles a refusal. The API enforces the role in
  // apps/api/src/quoting/catalog.controller.ts.
  const canWrite = PRICING_CONFIG_WRITE_ROLES.some((role) => me.roles.includes(role));

  const byFamily = new Map<ProductFamily, Grade[]>(PRODUCT_FAMILIES.map((family) => [family, []]));
  for (const grade of grades) {
    byFamily.get(grade.productFamily)?.push(grade);
  }

  return (
    <PageShell>
      <h1>Paper grades</h1>

      <PageLede>
        The paper grades every quote line is priced from. A grade needs a footage variant before a
        line can use it.
      </PageLede>

      <DataLine>
        {grades.length} grade{grades.length === 1 ? '' : 's'} in the catalog.
      </DataLine>

      <ErrorBanner message={error} />
      {notice !== undefined && notice !== '' && <InfoBanner>{notice}</InfoBanner>}

      {grades.length === 0 && (
        <InfoBanner>
          The catalog is empty, so no quote can add a line yet.{' '}
          {canWrite
            ? 'Add the first grade at the bottom of this page.'
            : 'A Billing Manager adds the first grade here.'}
        </InfoBanner>
      )}

      {!canWrite && (
        <SectionNote>{onlyDesk('the Billing Manager', 'changes the catalog')}</SectionNote>
      )}

      {PRODUCT_FAMILIES.map((family) => {
        const familyGrades = byFamily.get(family) ?? [];
        return (
          <Section
            key={family}
            title={PRODUCT_FAMILY_LABELS[family]}
            note={
              (familyFits.get(family) ?? []).length === 0
                ? undefined
                : "A custom width prices from the family's nearest step at or below it."
            }
          >
            <FamilySteps fits={familyFits.get(family) ?? []} />
            {familyGrades.length === 0 ? (
              <EmptyState>No {PRODUCT_FAMILY_LABELS[family]} grades yet.</EmptyState>
            ) : (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <QueueTable columns={COLUMNS}>
                    {familyGrades.map((grade) => (
                      <GradeRow key={grade.id} grade={grade} />
                    ))}
                  </QueueTable>
                </div>
                {canWrite && (
                  <div style={{ display: 'grid', gap: SPACE.md, marginTop: SPACE.lg }}>
                    {familyGrades.map((grade) => (
                      <Fold key={grade.id} summary={`Change ${grade.code}`} sum={gradeSum(grade)}>
                        <EditGradeForm grade={grade} />
                      </Fold>
                    ))}
                  </div>
                )}
              </>
            )}
          </Section>
        );
      })}

      {canWrite && (
        <div style={{ marginTop: SPACE.xxl }}>
          <Fold summary="Add a grade" open={grades.length === 0}>
            <SectionNote>
              The grade saves without a variant, and the quote form cannot use it until it has one.
            </SectionNote>
            <CreateGradeForm />
          </Fold>
        </div>
      )}
    </PageShell>
  );
}

function GradeChanged({ updatedAt }: { updatedAt: string }) {
  return (
    <span style={{ color: COLOR.muted }}>
      {isUnsetTimestamp(updatedAt)
        ? 'not changed since setup'
        : `updated ${formatTimestamp(updatedAt)}`}
    </span>
  );
}

function gradeSum(grade: Grade): string {
  const variants = grade.footages.length;
  const widths = grade.widths.length;
  return `${String(variants)} variant${variants === 1 ? '' : 's'} · ${String(widths)} stock width${widths === 1 ? '' : 's'}`;
}

function GradeRow({ grade }: { grade: Grade }) {
  return (
    <tr>
      <QueueCell>
        <strong>{grade.code}</strong>
      </QueueCell>
      <QueueCell num>{measureText(grade.basisWeightLb)}</QueueCell>
      <QueueCell num>{measureText(grade.reamAreaDivisor)}</QueueCell>
      <QueueCell num>{formatMoney(grade.paperCostPerTonne)}</QueueCell>
      <QueueCell>
        {grade.footages.length === 0 ? (
          <span style={{ color: COLOR.warning }}>
            No variants, so a quote line cannot price this grade yet.
          </span>
        ) : (
          grade.footages.map((footage, i) => (
            <span key={footage.variant}>
              {i > 0 && ' · '}
              {footage.label} ({footage.variant}) — {measureText(footage.feetPerRoll)} ft/roll
            </span>
          ))
        )}
      </QueueCell>
      <QueueCell>
        {grade.widths.length === 0 ? (
          <span style={{ color: COLOR.muted }}>None, so every width is a custom width.</span>
        ) : (
          grade.widths.map(widthListText).join(' · ')
        )}
      </QueueCell>
      <QueueCell>
        <GradeChanged updatedAt={grade.updatedAt} />
      </QueueCell>
    </tr>
  );
}

function EditGradeForm({ grade }: { grade: Grade }) {
  return (
    <form action={updateGradeAction} style={formGrid}>
      <input type="hidden" name="gradeId" value={grade.id} />

      <input type="hidden" name="lockVersion" value={grade.lockVersion} />

      <input type="hidden" name="productFamily" value={grade.productFamily} />

      <GradeFields grade={grade} />

      {grade.footages.length === 0 && (
        <p style={warningText}>
          No variants, so a quote line cannot price this grade yet. Add one below.
        </p>
      )}

      <FootageRows footages={grade.footages} />

      <WidthRows widths={grade.widths} />

      <div>
        <Button>Save grade</Button>
      </div>
    </form>
  );
}

function CreateGradeForm() {
  return (
    <form action={createGradeAction} style={formGrid}>
      <FieldRow>
        <Field>
          <FieldLabel>Product family</FieldLabel>
          <Select name="productFamily" defaultValue="">
            <option value="">— pick a family —</option>
            {PRODUCT_FAMILIES.map((family) => (
              <option key={family} value={family}>
                {PRODUCT_FAMILY_LABELS[family]}
              </option>
            ))}
          </Select>
          <Hint>A code is unique within its family.</Hint>
        </Field>
      </FieldRow>

      <GradeFields grade={undefined} />

      <FootageRows footages={[]} />

      <WidthRows widths={[]} />

      <div>
        <Button variant="primary">Add grade</Button>
      </div>
    </form>
  );
}

function GradeFields({ grade }: { grade: Grade | undefined }) {
  return (
    <FieldRow>
      <Field>
        <FieldLabel>Grade code</FieldLabel>
        <Input
          type="text"
          name="code"
          maxLength={64}
          placeholder="40#"
          defaultValue={grade?.code ?? ''}
          style={{ width: 150 }}
        />
      </Field>

      <Field>
        <FieldLabel>Basis weight (lb)</FieldLabel>
        <Input
          type="text"
          inputMode="decimal"
          pattern={POSITIVE_DECIMAL_PATTERN}
          name="basisWeightLb"
          defaultValue={grade?.basisWeightLb ?? ''}
          style={{ width: 110 }}
        />
      </Field>

      <Field>
        <FieldLabel>Ream area divisor</FieldLabel>
        <Input
          type="text"
          inputMode="decimal"
          pattern={POSITIVE_DECIMAL_PATTERN}
          name="reamAreaDivisor"
          defaultValue={grade?.reamAreaDivisor ?? DEFAULT_REAM_AREA_DIVISOR}
          style={{ width: 110 }}
        />
        <Hint>432 for a 24 by 36 ream; 187 for bond.</Hint>
      </Field>

      <Field>
        <FieldLabel>Paper cost ($/tonne)</FieldLabel>
        <Input
          type="text"
          inputMode="decimal"
          pattern={POSITIVE_DECIMAL_PATTERN}
          name="paperCostPerTonne"
          defaultValue={grade?.paperCostPerTonne ?? ''}
          style={{ width: 130 }}
        />
      </Field>
    </FieldRow>
  );
}

function FootageRows({ footages }: { footages: readonly GradeFootage[] }) {
  return (
    <fieldset style={footageFieldset}>
      <legend style={legendStyle}>Footage variants</legend>
      {footages.map((footage, i) => (
        <FootageRow key={footage.variant} index={i} footage={footage} />
      ))}
      <FootageRow index={footages.length} footage={undefined} />
      <Hint>Variant is a short code. One new row per save.</Hint>

      {footages.length > 0 && (
        <Hint>Removing a variant is refused while draft quote lines still use it.</Hint>
      )}
    </fieldset>
  );
}

function FootageRow({ index, footage }: { index: number; footage: GradeFootage | undefined }) {
  return (
    <FieldRow>
      <Field>
        <FieldLabel>Variant</FieldLabel>
        <Input
          type="text"
          name={`footages[${index}].variant`}
          maxLength={32}
          defaultValue={footage?.variant ?? ''}
          style={{ width: 80 }}
        />
      </Field>

      <Field>
        <FieldLabel>Label</FieldLabel>
        <Input
          type="text"
          name={`footages[${index}].label`}
          maxLength={64}
          defaultValue={footage?.label ?? ''}
          style={{ width: 170 }}
        />
      </Field>

      <Field>
        <FieldLabel>Feet / roll</FieldLabel>
        <Input
          type="text"
          inputMode="decimal"
          pattern={POSITIVE_DECIMAL_PATTERN}
          name={`footages[${index}].feetPerRoll`}
          defaultValue={footage?.feetPerRoll ?? ''}
          style={{ width: 110 }}
        />
      </Field>

      {footage === undefined ? (
        <span
          style={{
            fontSize: FONT_SIZE.sm,
            color: COLOR.muted,
            alignSelf: 'flex-end',
            paddingBottom: SPACE.md,
          }}
        >
          new variant
        </span>
      ) : (
        <CheckboxLabel align="bottom">
          <input type="checkbox" name={`footages[${index}].remove`} /> Remove on save
        </CheckboxLabel>
      )}
    </FieldRow>
  );
}

function WidthRows({ widths }: { widths: readonly GradeWidth[] }) {
  return (
    <fieldset style={footageFieldset}>
      <legend style={legendStyle}>Stock widths</legend>
      {widths.map((width, i) => (
        <WidthRow key={width.rollWidthIn} index={i} width={width} />
      ))}
      <WidthRow index={widths.length} width={undefined} />
      <Hint>
        {widths.length === 0
          ? "A new grade with none starts on its family's widths."
          : 'Removing a width is refused while draft quote lines still use it.'}
      </Hint>
    </fieldset>
  );
}

function WidthRow({ index, width }: { index: number; width: GradeWidth | undefined }) {
  return (
    <FieldRow>
      <Field>
        <FieldLabel>Width (in)</FieldLabel>

        <Input
          type="number"
          name={`widths[${index}].rollWidthIn`}
          min={1}
          max={1000}
          step="any"
          defaultValue={width === undefined ? '' : String(width.rollWidthIn)}
          style={{ width: 90 }}
        />
      </Field>

      <Field>
        <FieldLabel>Rolls / pallet</FieldLabel>
        <Input
          type="number"
          name={`widths[${index}].rollsPerPallet`}
          min={1}
          max={10000}
          step={1}
          defaultValue={
            width === undefined || width.rollsPerPallet === null ? '' : String(width.rollsPerPallet)
          }
          style={{ width: 90 }}
        />
      </Field>

      {width === undefined ? (
        <span
          style={{
            fontSize: FONT_SIZE.sm,
            color: COLOR.muted,
            alignSelf: 'flex-end',
            paddingBottom: SPACE.md,
          }}
        >
          new width
        </span>
      ) : (
        <CheckboxLabel align="bottom">
          <input type="checkbox" name={`widths[${index}].remove`} /> Remove on save
        </CheckboxLabel>
      )}
    </FieldRow>
  );
}

function FamilySteps({
  fits,
}: {
  fits: readonly { rollWidthIn: number; rollsPerPallet: number }[];
}) {
  if (fits.length === 0) {
    return null;
  }
  return (
    <ul
      aria-label="Family pallet fits"
      style={{
        ...DATA_LINE_STYLE,
        listStyle: 'none',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.25rem 1rem',
        padding: 0,
      }}
    >
      {fits.map((fit) => (
        <li key={fit.rollWidthIn}>
          {`${formatWidthIn(fit.rollWidthIn)}: ${String(fit.rollsPerPallet)} rolls a pallet`}
        </li>
      ))}
    </ul>
  );
}

function measureText(value: string): string {
  return formatMoney(value).replace('$', '');
}

const POSITIVE_DECIMAL_PATTERN = '(?=.*[1-9])\\d+(\\.\\d{1,4})?';

const formGrid = { display: 'grid', gap: SPACE.md } as const;

const warningText = { fontSize: '0.85rem', color: COLOR.warning, margin: 0 } as const;

const footageFieldset = {
  border: `1px solid ${COLOR.border}`,
  borderRadius: 6,
  padding: '0.5rem 0.75rem',
  display: 'grid',
  gap: '0.5rem',
  margin: 0,
} as const;

const legendStyle = { padding: '0 0.25rem', fontSize: '0.8rem', color: COLOR.muted } as const;
