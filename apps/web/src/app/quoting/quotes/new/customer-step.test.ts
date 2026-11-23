// Tests the customer search on New quote, and reads the page source to check that each state renders what it should.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { customerSearchResponseSchema, type Customer } from '@erp/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchParsed } from '../../../../lib/fetch-parsed';
import { resolvePaging } from '../../../../lib/paging';
import {
  DIRECTORY_HREF,
  DIRECTORY_LINK_LABEL,
  loadCustomerStep,
  SEARCH_FIRST_SENTENCE,
} from './customer-step';

vi.mock('../../../../lib/fetch-parsed', () => ({ fetchParsed: vi.fn() }));

const fetchMock = vi.mocked(fetchParsed);

function customer(name: string): Customer {
  return { id: `id-${name}`, name, creditHold: false } as unknown as Customer;
}

function answers(items: Customer[], total: number): void {
  fetchMock.mockResolvedValue({ items, total } as never);
}

describe('loadCustomerStep', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('makes no search request with no term, and carries nothing to list or count', async () => {
    for (const q of ['', '   ', '\t']) {
      expect(await loadCustomerStep(q, resolvePaging({}))).toEqual({ kind: 'prompt' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('searches a term of one character or more, 20 a page, with a count line', async () => {
    answers([customer('Sample Demo Paper'), customer('Sample Demo Printers')], 2);

    const step = await loadCustomerStep('R', resolvePaging({}));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/crm/customers?q=R&limit=20&offset=0',
      customerSearchResponseSchema,
    );
    expect(step).toEqual({
      kind: 'results',
      customers: [customer('Sample Demo Paper'), customer('Sample Demo Printers')],
      total: 2,
      showing: 'Showing 1 to 2 of 2.',
    });
  });

  it('sends the trimmed term, and pages by the size and page asked for', async () => {
    answers([customer('Example Customer & Sons')], 3);

    const step = await loadCustomerStep(
      '  Example Customer & Sons ',
      resolvePaging({ page: '2', size: '1' }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/crm/customers?q=Example%20Customer%20%26%20Sons&limit=1&offset=1',
      customerSearchResponseSchema,
    );
    expect(step.kind === 'results' && step.showing).toBe('Showing 2 to 2 of 3.');
  });

  it('answers a term that matches nothing with no rows and no count line', async () => {
    answers([], 0);

    expect(await loadCustomerStep('Zzyzx', resolvePaging({}))).toEqual({
      kind: 'results',
      customers: [],
      total: 0,
      showing: null,
    });
  });

  it('says the agreed words', () => {
    expect(SEARCH_FIRST_SENTENCE).toBe("Type part of a customer's name to find them.");
    expect(DIRECTORY_LINK_LABEL).toBe('Open the customer directory');
    expect(DIRECTORY_HREF).toBe('/crm/customers');
  });
});

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, ' ');
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function body(source: string, signature: string): string {
  const from = source.indexOf(signature);
  expect(from, `${signature} not found`).toBeGreaterThanOrEqual(0);
  const rest = source.slice(from + signature.length);
  const end = rest.search(/ function [A-Z]\w*\(/);
  return signature + (end === -1 ? rest : rest.slice(0, end));
}

const [SENTENCE = ''] = Object.keys({ SEARCH_FIRST_SENTENCE });
const [HREF = ''] = Object.keys({ DIRECTORY_HREF });
const [LABEL = ''] = Object.keys({ DIRECTORY_LINK_LABEL });

const source = code(resolve(__dirname, 'page.tsx'));
const page = body(source, 'export default async function NewQuotePage');
const results = body(source, 'function CustomerResults(');

const PROMPT = `{step.kind === 'prompt' && <EmptyState>{${SENTENCE}}</EmptyState>}`;
const RESULTS = "{step.kind === 'results' && ( <CustomerResults ";
const LINK = `<a href={${HREF}} style={{ color: COLOR.accent }}> {${LABEL}} </a>`;

describe('the New quote page', () => {
  it('reads the step from the loader, once', () => {
    expect(count(page, 'await loadCustomerStep(q, paging)')).toBe(1);
    expect(count(source, 'fetchParsed')).toBe(0);
    expect(count(source, '/crm/customers?q=')).toBe(0);
  });

  it('with no term, renders the sentence and nothing to count or page', () => {
    expect(count(page, PROMPT)).toBe(1);

    for (const listPart of [
      '<Paginator',
      '<DataLine',
      '<ResetList',
      'showing',
      'Showing',
      'No customers matched.',
      'Start quote',
    ]) {
      expect(count(page, listPart), listPart).toBe(0);
    }
    expect(count(page, '<CustomerResults ')).toBe(1);
    expect(count(page, RESULTS)).toBe(1);
    expect(results).toContain("step: Extract<CustomerStep, { kind: 'results' }>;");
  });

  it('keeps the count line, the paging and the empty state in the searched list', () => {
    expect(count(source, '<Paginator')).toBe(1);
    expect(count(results, '<Paginator')).toBe(1);
    expect(count(source, '<DataLine')).toBe(1);
    expect(count(results, '{step.showing !== null && <DataLine>{step.showing}</DataLine>}')).toBe(
      1,
    );
    expect(count(results, 'total={step.total}')).toBe(1);
    expect(count(results, 'params={{ q, size }}')).toBe(1);
    expect(
      count(
        results,
        'step.customers.length === 0 ? ( <EmptyState>No customers matched.</EmptyState>',
      ),
    ).toBe(1);
  });

  it('links to the directory once, outside both states, so every state has it', () => {
    expect(count(source, LINK)).toBe(1);
    expect(count(page, LINK)).toBe(1);
    const link = page.indexOf(LINK);
    expect(link).toBeGreaterThan(page.indexOf(PROMPT));
    expect(link).toBeLessThan(page.indexOf(RESULTS));

    expect(page.indexOf('New customer </a>')).toBeGreaterThan(link);
    expect(page.indexOf('New customer </a>')).toBeLessThan(page.indexOf(RESULTS));
  });
});
