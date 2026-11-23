// Turns the API's report on a rates file into the one message the Tax rates page shows.
import type { ImportTaxRatesResponse } from '@erp/types';

const NAMED_LIMIT = 3;

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function agrees(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function andList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] as string}`;
}

function withOverflow(named: readonly string[], total: number): string {
  const shown = named.slice(0, NAMED_LIMIT);
  const rest = total - shown.length;
  return rest > 0 ? `${andList(shown)}, and ${String(rest)} more` : andList(shown);
}

export interface LoadSummary {
  readonly channel: 'error' | 'notice';
  readonly message: string;
}

export function summariseLoad(report: ImportTaxRatesResponse): LoadSummary {
  const conflicts = report.rows.filter((row) => row.verdict === 'conflict');

  // A refused load writes nothing at all. One unreadable line or one conflicting rate refuses the whole file.
  if (report.refused) {
    const reasons: string[] = [];

    if (report.issues.length > 0) {
      reasons.push(
        `${plural(report.issues.length, 'line', 'lines')} could not be read (${withOverflow(
          report.issues.map((issue) => `line ${String(issue.line)}: ${issue.message}`),
          report.issues.length,
        )})`,
      );
    }

    if (conflicts.length > 0) {
      reasons.push(
        `${plural(conflicts.length, 'jurisdiction', 'jurisdictions')} already ${agrees(conflicts.length, 'has', 'have')} a different rate for that date (${withOverflow(
          conflicts.map(
            (row) =>
              `${row.jurisdiction} on ${row.effectiveFrom} is ${row.storedRate ?? 'on file'}, not ${row.rate}`,
          ),
          conflicts.length,
        )})`,
      );
    }

    return {
      channel: 'error',
      message:
        `Nothing was loaded. ${andList(reasons)}.` +
        (conflicts.length > 0
          ? ' A rate that has changed needs a later effective date. Nothing is overwritten.'
          : ''),
    };
  }

  const fresh = report.rows.filter((row) => row.verdict === 'new').length;
  const already = report.rows.filter((row) => row.verdict === 'unchanged').length;

  const toFill = report.rows.filter((row) => row.fillsParts === true).length;

  if (report.dryRun) {
    return {
      channel: 'notice',
      message:
        `Checked ${plural(report.rows.length, 'row', 'rows')}: ${String(fresh)} new, ` +
        `${String(already)} already on file. ` +
        (toFill > 0
          ? `Loading fills in State, Local and RTA on ${plural(toFill, 'row', 'rows')}. `
          : '') +
        `Nothing was written — choose the file again and press “Load these rates” to apply them.`,
    };
  }

  return {
    channel: 'notice',
    message:
      `Loaded ${plural(report.inserted, 'rate', 'rates')}.` +
      (report.skipped > 0
        ? ` ${String(report.skipped)} ${agrees(report.skipped, 'was', 'were')} already on file.`
        : '') +
      (report.filled > 0
        ? ` Filled in State, Local and RTA on ${plural(report.filled, 'row', 'rows')}.`
        : ''),
  };
}
