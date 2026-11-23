// Tests the sales tax code lookup link, partly by reading source: the link component must stay one plain anchor
// with no client script, and each tax jurisdiction box listed in PLACES must render the link once.
// A failure means a box lost its link or the component grew client code.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DOR_LOOKUP_URL, DOR_LOOKUP_WORDS } from './dor-lookup';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const APP = resolve(__dirname, '..', 'app');
const QUOTE = resolve(APP, 'quoting', 'quotes', '[id]');

const PLACES = [
  {
    name: 'the Delivery and tax card',
    file: resolve(QUOTE, 'delivery', 'page.tsx'),
    box: 'name={`lines[${index}].taxJurisdiction`}',
    hidden: true,
  },
  {
    name: "the Lines step's tax row",
    file: resolve(QUOTE, 'components', 'line-inputs.tsx'),
    box: 'name={`lines[${index}].taxJurisdiction`}',
    hidden: true,
  },
  {
    name: 'the customer form',
    file: resolve(APP, 'crm', 'customers', 'customer-form.tsx'),
    box: 'name="taxJurisdiction"',
    hidden: false,
  },
];

describe('the DOR lookup link', () => {
  it("goes to the state's address lookup", () => {
    expect(DOR_LOOKUP_URL).toBe('https://webgis.dor.wa.gov/taxratelookup/salestax.aspx');
  });

  it('says what it is for', () => {
    expect(DOR_LOOKUP_WORDS).toBe('Find the code on the DOR site');
  });

  it('is one plain anchor that opens a new tab and sends no referrer', () => {
    const source = code(resolve(__dirname, 'dor-lookup-link.tsx'));
    expect(source).not.toContain("'use client'");
    expect(count(source, '<a')).toBe(1);
    expect(source).toContain('href={DOR_LOOKUP_URL}');
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).toContain('{DOR_LOOKUP_WORDS}');

    expect(source).not.toContain('dor.wa.gov');
    expect(source).not.toContain('Find the code');
  });
});

describe.each(PLACES)('$name', ({ file, box, hidden }) => {
  const source = code(file);
  const open = source.indexOf('<WithDorLookup>');
  const close = source.indexOf('</WithDorLookup>');

  it('renders the link once, round the field that holds the box', () => {
    expect(source).toMatch(/import \{ WithDorLookup \} from '(\.\.\/)+lib\/dor-lookup-link';/);
    expect(count(source, '<WithDorLookup>')).toBe(1);
    expect(count(source, '</WithDorLookup>')).toBe(1);
    const wrapped = source.slice(open, close);
    expect(count(wrapped, '<Field>')).toBe(1);
    expect(count(wrapped, '</Field>')).toBe(1);
    expect(wrapped).toContain(box);
  });

  it(
    hidden
      ? 'sits inside the wrapper that hides the box, so the link hides with it'
      : 'sits in the row as the box did, shown for every treatment',
    () => {
      const wrapper = '<div className={TAX_JURISDICTION_CLASS}>';
      if (hidden) {
        expect(count(source, wrapper)).toBe(1);
        expect(source.slice(source.indexOf(wrapper) + wrapper.length, open).trim()).toBe('');
        expect(source.slice(close + '</WithDorLookup>'.length).trimStart()).toMatch(/^<\/div>/);
      } else {
        expect(source).not.toContain('TAX_JURISDICTION_CLASS');
      }
    },
  );
});
