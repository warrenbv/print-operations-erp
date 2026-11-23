// Reads the source of the customer form and its two pages, comments stripped, and checks the heading row:
// one Save button that submits the one form by id, with the same label as the button at the foot.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CUSTOMER_FORM_ID } from './customer-form-id';

const FORM_FILE = resolve(__dirname, 'customer-form.tsx');

const PAGES = [
  {
    name: 'New customer',
    page: resolve(__dirname, 'new', 'page.tsx'),
    labels: ["'Add customer'", "'Add customer and return'"],
  },
  {
    name: 'Edit customer',
    page: resolve(__dirname, '[id]', 'edit', 'page.tsx'),
    labels: ["'Save customer'"],
  },
];

const [ID_NAME = ''] = Object.keys({ CUSTOMER_FORM_ID });
const ID_EXPRESSION = `{${ID_NAME}}`;
const IMPORTS_THE_ID = new RegExp(
  `import \\{ ${ID_NAME} \\} from '(\\./|(\\.\\./)+)customer-form-id';`,
);

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function attributeOf(source: string, tag: string, attribute: string): string {
  const start = source.indexOf(tag);
  expect(start, `${tag} not found`).toBeGreaterThanOrEqual(0);
  const element = source.slice(start, source.indexOf('>', start));
  return new RegExp(`\\s${attribute}=(\\{[^}]*\\}|"[^"]*")`).exec(element)?.[1] ?? '';
}

const formSource = code(FORM_FILE);
const headFrom = formSource.slice(formSource.indexOf('export function CustomerFormHead'));
const head = headFrom.slice(0, headFrom.indexOf('\n}\n'));

describe('the heading row', () => {
  it('reads the id from the one constant, and the constant is a usable id', () => {
    expect(formSource).toMatch(IMPORTS_THE_ID);
    expect(CUSTOMER_FORM_ID).toMatch(/^[a-z][a-z-]*$/);
  });

  it('is the heading, then one kit Button that submits the customer form', () => {
    expect(head).not.toBe('');
    expect(count(head, '<h1')).toBe(1);
    expect(count(head, '<Button')).toBe(1);
    expect(head.indexOf('<h1')).toBeLessThan(head.indexOf('<Button'));
    expect(attributeOf(head, '<Button', 'form')).toBe(ID_EXPRESSION);
    expect(head).toContain('>{saveLabel}</Button>');
  });

  it('is the default variant, as the foot button is, not a smaller one', () => {
    expect(attributeOf(head, '<Button', 'variant')).toBe('');
  });
});

describe.each(PAGES)('$name', ({ page, labels }) => {
  const source = code(page);

  it("has one form, and its id is the value the top button's form attribute names", () => {
    expect(count(source, '<form')).toBe(1);
    expect(source).toMatch(IMPORTS_THE_ID);
    const formId = attributeOf(source, '<form', 'id');
    expect(formId).toBe(attributeOf(head, '<Button', 'form'));
    expect(formId).toBe(ID_EXPRESSION);
  });

  it('draws the heading row and the foot button from the one label', () => {
    expect(count(source, '<CustomerFormHead ')).toBe(1);
    expect(count(source, 'saveLabel={saveLabel}')).toBe(1);

    expect(count(source, '<Button')).toBe(1);
    expect(count(source, '<Button>{saveLabel}</Button>')).toBe(1);
    expect(source.indexOf('<Button>')).toBeGreaterThan(source.indexOf('<form'));
    expect(source.indexOf('<Button>')).toBeLessThan(source.indexOf('</form>'));
  });

  it('defines that label once, in the words the page has always used', () => {
    expect(count(source, 'const saveLabel =')).toBe(1);
    const definition = source.slice(source.indexOf('const saveLabel ='));
    const statement = definition.slice(0, definition.indexOf(';'));
    for (const label of labels) {
      expect(statement).toContain(label);
    }
  });
});
