// Tests for the register rules in docs-integrity. They import the rules from
// the script itself. Register rows, ids and dates are fictional.
import { describe, expect, it } from 'vitest';

import {
  REGISTERS,
  findDuplicateRegisterIds,
  findRowShapeMismatches,
  splitTableRow,
} from './docs-integrity.mjs';

describe('splitTableRow', () => {
  it('splits a row into trimmed cells, dropping the outer empties', () => {
    expect(splitTableRow('| **OD-1031** | A decision  | 2026-01-15 |')).toEqual([
      '**OD-1031**',
      'A decision',
      '2026-01-15',
    ]);
  });

  it('honours escaped pipes inside a cell', () => {
    // A cell quoting the base conflict marker must not split into extra cells.
    expect(splitTableRow('| a | uses \\|\\| inside | b |')).toEqual([
      'a',
      'uses \\|\\| inside',
      'b',
    ]);
  });
});

describe('findRowShapeMismatches', () => {
  const table = (...rows) => rows.join('\n');

  it('accepts a well-formed table', () => {
    const text = table(
      '| ID | Decision | Outcome | Date |',
      '| --- | --- | --- | --- |',
      '| **OD-1001** | x | y | 2026-01-05 |',
    );
    expect(findRowShapeMismatches(text)).toEqual([]);
  });

  it('catches a row moved between tables with the source columns attached', () => {
    const text = table(
      '| ID | Decision | Outcome | Date |',
      '| --- | --- | --- | --- |',
      '| **OD-1030** | who signs off | a role | Owner | Unblocks a story | Resolved 2026-01-14 |',
    );
    const found = findRowShapeMismatches(text);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ cells: 6, expected: 4, id: '**OD-1030**' });
  });

  it('catches a row saved a cell short', () => {
    const text = table(
      '| ID | Ask | Answer | Date |',
      '| --- | --- | --- | --- |',
      '| **SQ-2002** | zips? | no zone table exists. |',
    );
    const found = findRowShapeMismatches(text);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ cells: 3, expected: 4 });
  });

  it('never flags the separator row', () => {
    const text = table('| a | b |', '| --------- | :---: |', '| 1 | 2 |');
    expect(findRowShapeMismatches(text)).toEqual([]);
  });

  it('resets at each table — a 6-column Open table above a 4-column Resolved table is fine', () => {
    const text = [
      '| ID | Decision | Options | Who | Blocks | By |',
      '| --- | --- | --- | --- | --- | --- |',
      '| **OD-1031** | a | b | c | d | e |',
      '',
      '## Resolved',
      '',
      '| ID | Decision | Outcome | Date |',
      '| --- | --- | --- | --- |',
      '| **OD-1032** | a | b | 2026-01-15 |',
    ].join('\n');
    expect(findRowShapeMismatches(text)).toEqual([]);
  });

  it('reports the 1-indexed line number', () => {
    const text = ['prose', '| a | b |', '| --- | --- |', '| 1 | 2 | 3 |'].join('\n');
    expect(findRowShapeMismatches(text)[0]?.line).toBe(4);
  });
});

describe('findDuplicateRegisterIds', () => {
  it('accepts unique ids across both tables of a register', () => {
    const text = [
      '| **OD-1031** | open |',
      '| **OD-1005** | open |',
      '| **OD-1032** | resolved |',
    ].join('\n');
    expect(findDuplicateRegisterIds(text)).toEqual([]);
  });

  it('catches the renumber-on-merge race — two rows claiming one id', () => {
    // Two branches each raise the next free id, and both rows reach the main branch.
    const text = ['| **OD-1028** | effect seams |', '| **OD-1028** | who signs off |'].join('\n');
    const dupes = findDuplicateRegisterIds(text);
    expect(dupes).toHaveLength(1);
    expect(dupes[0]).toMatchObject({ id: 'OD-1028', line: 2, first: 1 });
  });

  it('counts only ids in a row FIRST cell — prose references to other entries do not', () => {
    const text = [
      '| **OD-1029** | send log | pairs with OD-1030 and replaces OD-1028 | 2026-01-14 |',
      '| **OD-1030** | who signs off | see OD-1029 | 2026-01-14 |',
    ].join('\n');
    expect(findDuplicateRegisterIds(text)).toEqual([]);
  });

  it('covers SQ ids the same way', () => {
    const text = ['| **SQ-2010** | proofing |', '| **SQ-2010** | proofing again |'].join('\n');
    expect(findDuplicateRegisterIds(text)[0]?.id).toBe('SQ-2010');
  });
});

describe('REGISTERS', () => {
  it('names exactly the two register files', () => {
    expect(REGISTERS).toEqual(['docs/registers/decision-log.md', 'docs/registers/question-log.md']);
  });
});
