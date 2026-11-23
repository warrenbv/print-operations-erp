// Parses a tax-rate import into rows and per-line issues, without touching storage.
// It reads two formats: the system's own rows, and the state tax authority's published rate file.
// The service that compares the rows with stored rates and writes them: modules/quoting/src/services/tax-rate-service.ts.
import { DECIMAL_SCALES } from './decimal';
import {
  newTaxRateSchema,
  type NewTaxRate,
  type TaxRateImportFormat,
  type TaxRateImportIssue,
  type TaxRateParts,
} from './tax-rate';

export interface ParsedTaxRates {
  readonly rows: readonly NewTaxRate[];
  readonly issues: readonly TaxRateImportIssue[];
}

export function parseTaxRateImport(text: string, format: TaxRateImportFormat): ParsedTaxRates {
  return format === 'wa_dor_rates' ? parseDorRatesCsv(text) : parseTaxRateRows(text);
}

interface SourceLine {
  readonly line: number;
  readonly text: string;
}

function sourceLines(text: string): readonly SourceLine[] {
  return text
    .replace(/^\uFEFF/, '')
    .split('\n')
    .map((raw, index) => ({ line: index + 1, text: raw.replace(/\r$/, '') }));
}

function isSkippable(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === '' || trimmed.startsWith('#');
}

function splitFields(text: string, delimiter: string): readonly string[] {
  return text.split(delimiter).map((field) => field.trim());
}

// The stored rate is built from the string, padded to the rate scale. `Number` serves only the range check.
function readRate(raw: string): { rate: string } | { error: string } {
  if (raw === '') return { error: 'rate is blank' };
  if (!/^\d*\.?\d+$/.test(raw)) {
    return { error: `rate "${raw}" is not a decimal number` };
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) return { error: `rate "${raw}" is not a number` };
  if (value >= 1) {
    return {
      error: `rate "${raw}" is not a ratio — a rate of 8.5% is written 0.085, and the table refuses anything at or above 1`,
    };
  }
  const [whole = '0', fraction = ''] = raw.split('.');
  if (fraction.length > DECIMAL_SCALES.rate) {
    return {
      error: `rate "${raw}" has ${String(fraction.length)} decimal places; at most ${String(DECIMAL_SCALES.rate)} are stored`,
    };
  }
  return { rate: `${whole === '' ? '0' : whole}.${fraction.padEnd(DECIMAL_SCALES.rate, '0')}` };
}

function keyOf(row: NewTaxRate): string {
  return `${row.jurisdiction}|${row.effectiveFrom}`;
}

function accept(
  candidate: NewTaxRate,
  line: number,
  seen: Map<string, number>,
  rows: NewTaxRate[],
  issues: TaxRateImportIssue[],
): void {
  const parsed = newTaxRateSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    issues.push({
      line,
      message:
        issue === undefined ? 'row is not valid' : `${issue.path.join('.')}: ${issue.message}`,
    });
    return;
  }
  const key = keyOf(parsed.data);
  const first = seen.get(key);
  if (first !== undefined) {
    issues.push({
      line,
      message: `${parsed.data.jurisdiction} on ${parsed.data.effectiveFrom} is already given on line ${String(first)}`,
    });
    return;
  }
  seen.set(key, line);
  rows.push(parsed.data);
}

const ERP_COLUMNS = 'jurisdiction, rate, effectiveFrom, source[, name]';

export function parseTaxRateRows(text: string): ParsedTaxRates {
  const rows: NewTaxRate[] = [];
  const issues: TaxRateImportIssue[] = [];
  const seen = new Map<string, number>();

  const lines = sourceLines(text).filter((line) => !isSkippable(line.text));
  if (lines.length === 0) {
    return { rows, issues };
  }

  const first = lines[0] as SourceLine;
  const delimiter = first.text.includes('\t') ? '\t' : ',';
  const headed = splitFields(first.text, delimiter)[0]?.toLowerCase() === 'jurisdiction';
  const body = headed ? lines.slice(1) : lines;

  for (const { line, text: raw } of body) {
    const fields = splitFields(raw, delimiter);
    if (fields.length < 4 || fields.length > 5) {
      issues.push({
        line,
        message: `expected ${ERP_COLUMNS} but found ${String(fields.length)} field(s)`,
      });
      continue;
    }
    const [jurisdiction = '', rawRate = '', effectiveFrom = '', source = '', name] = fields;
    const rate = readRate(rawRate);
    if ('error' in rate) {
      issues.push({ line, message: rate.error });
      continue;
    }
    accept(
      {
        jurisdiction,
        rate: rate.rate,
        effectiveFrom,
        source: source as NewTaxRate['source'],
        ...(name === undefined || name === '' ? {} : { name }),
      },
      line,
      seen,
      rows,
      issues,
    );
  }

  return { rows, issues };
}

const DOR_COLUMNS = {
  name: 'Name',
  code: 'Code',
  state: 'State',
  local: 'Local',
  rta: 'RTA',
  rate: 'Rate',
  effective: 'Effective Date',
} as const;

const DOR_CODE_WIDTH = 4;

export function dorJurisdiction(code: string): string {
  return `WA-${code.padStart(DOR_CODE_WIDTH, '0')}`;
}

function readDorDate(raw: string): { day: string } | { error: string } {
  if (!/^\d{8}$/.test(raw)) {
    return { error: `effective date "${raw}" is not 8 digits (YYYYMMDD)` };
  }
  return { day: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` };
}

// Rates carry at most six places, so whole millionths compare exactly where float sums would not.
function millionths(value: string): number {
  return Math.round(Number(value) * 1_000_000);
}

function storableParts(parts: readonly string[]): TaxRateParts {
  const [state, local, rta] = parts.map((part) => readRate(part));
  if (
    state === undefined ||
    local === undefined ||
    rta === undefined ||
    'error' in state ||
    'error' in local ||
    'error' in rta
  ) {
    return {};
  }
  return { stateRate: state.rate, localRate: local.rate, rtaRate: rta.rate };
}

export function parseDorRatesCsv(text: string): ParsedTaxRates {
  const rows: NewTaxRate[] = [];
  const issues: TaxRateImportIssue[] = [];
  const seen = new Map<string, number>();

  const lines = sourceLines(text).filter((line) => !isSkippable(line.text));
  const header = lines[0];
  if (header === undefined) {
    return { rows, issues: [{ line: 1, message: 'the file is empty' }] };
  }

  const columns = splitFields(header.text, ',');
  const at: Partial<Record<keyof typeof DOR_COLUMNS, number>> = {};
  for (const [key, label] of Object.entries(DOR_COLUMNS)) {
    const index = columns.indexOf(label);
    if (index === -1) {
      issues.push({
        line: header.line,
        message: `the header has no "${label}" column — this does not look like a DOR Rates release (found: ${columns.join(', ')})`,
      });
      continue;
    }
    at[key as keyof typeof DOR_COLUMNS] = index;
  }
  if (issues.length > 0) {
    return { rows, issues };
  }

  const field = (fields: readonly string[], key: keyof typeof DOR_COLUMNS): string =>
    fields[at[key] as number] ?? '';

  for (const { line, text: raw } of lines.slice(1)) {
    const fields = splitFields(raw, ',');
    if (fields.length !== columns.length) {
      issues.push({
        line,
        message: `expected ${String(columns.length)} fields to match the header but found ${String(fields.length)}`,
      });
      continue;
    }

    const code = field(fields, 'code');
    if (!/^\d{1,4}$/.test(code)) {
      issues.push({ line, message: `location code "${code}" is not 1 to 4 digits` });
      continue;
    }

    const rate = readRate(field(fields, 'rate'));
    if ('error' in rate) {
      issues.push({ line, message: rate.error });
      continue;
    }

    const parts = (['state', 'local', 'rta'] as const).map((key) => field(fields, key));
    if (parts.every((part) => /^\d*\.?\d+$/.test(part))) {
      const summed = parts.reduce((total, part) => total + millionths(part), 0);
      if (summed !== millionths(rate.rate)) {
        issues.push({
          line,
          message: `Rate ${field(fields, 'rate')} does not equal State + Local + RTA (${parts.join(' + ')}) — the release has redefined the total`,
        });
        continue;
      }
    }

    const effective = readDorDate(field(fields, 'effective'));
    if ('error' in effective) {
      issues.push({ line, message: effective.error });
      continue;
    }

    const name = field(fields, 'name');
    accept(
      {
        jurisdiction: dorJurisdiction(code),
        rate: rate.rate,
        effectiveFrom: effective.day,
        source: 'wa_dor',
        ...(name === '' ? {} : { name }),
        ...storableParts(parts),
      },
      line,
      seen,
      rows,
      issues,
    );
  }

  return { rows, issues };
}
