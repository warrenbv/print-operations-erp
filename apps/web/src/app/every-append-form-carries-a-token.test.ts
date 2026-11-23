// Structural test. The rule: every form that appends a record (a customer, a contact, a quote send, an
// order conversion) posts a freshly minted submission token, and its server action runs inside
// `withSubmissionToken`. A double click or a resent post then gets the first outcome instead of a second
// record: apps/web/src/lib/submission-token.ts.
// How it finds them: `APPENDS` names each form file and its action file, and the test searches their raw
// source text, comments included, for the hidden field and the wrapper. Do not quote that markup in a comment.
// A failure means a listed form or action lost its token. A new append form is added to `APPENDS` and to the count.
// The layer of checks this belongs to: docs/process/verifying-agent-written-code.md.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SUBMISSION_TOKEN_FIELD } from '../lib/submission-token';

const WEB = resolve(__dirname, '..', '..');

const APPENDS: readonly { form: string; action: string; wiredTo: string }[] = [
  {
    form: 'src/app/crm/customers/new/page.tsx',
    action: 'src/app/crm/customers/actions.ts',
    wiredTo: 'createCustomerAction',
  },
  {
    form: 'src/app/crm/customers/[id]/page.tsx',
    action: 'src/app/crm/customers/[id]/contacts/actions.ts',
    wiredTo: 'createContactAction',
  },
  {
    form: 'src/app/quoting/quotes/[id]/components/quote-document-section.tsx',
    action: 'src/app/quoting/quotes/[id]/actions.ts',
    wiredTo: 'sendQuoteAction',
  },

  {
    form: 'src/app/quoting/quotes/[id]/convert/page.tsx',
    action: 'src/app/quoting/quotes/[id]/convert/actions.ts',
    wiredTo: 'convertQuoteAction',
  },
];

function read(relative: string): string {
  return readFileSync(resolve(WEB, relative), 'utf8');
}

describe('the append forms', () => {
  it('covers every action that carries a token', () => {
    expect(APPENDS).toHaveLength(4);
  });

  for (const { form, action, wiredTo } of APPENDS) {
    it(`${wiredTo}: its form renders the hidden field`, () => {
      const source = read(form);
      expect(source, `${form} should render <form action={${wiredTo}}>`).toContain(
        `action={${wiredTo}}`,
      );
      expect(source, `${form} should carry the ${SUBMISSION_TOKEN_FIELD} field`).toContain(
        `name={SUBMISSION_TOKEN_FIELD}`,
      );

      expect(source).toContain('value={mintSubmissionToken()}');
    });

    it(`${wiredTo}: its action consumes the token`, () => {
      const source = read(action);
      expect(source, `${action} should read ${SUBMISSION_TOKEN_FIELD}`).toContain(
        'SUBMISSION_TOKEN_FIELD',
      );
      expect(source, `${action} should run inside withSubmissionToken`).toContain(
        'withSubmissionToken(',
      );
    });
  }

  it('mints a token for each of the two send buttons, not one for both', () => {
    const source = read('src/app/quoting/quotes/[id]/components/quote-document-section.tsx');
    const minted = source.match(/value=\{mintSubmissionToken\(\)\}/g) ?? [];
    expect(minted).toHaveLength(2);
  });
});
