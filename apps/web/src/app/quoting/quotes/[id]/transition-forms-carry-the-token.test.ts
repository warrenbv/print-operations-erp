// Structural test of the quote's transition forms. It reads the source of the Review and send panel,
// the record page and the Close page, and fails when a form that moves the quote does not carry the
// quote's lockVersion, or when its action does not read it: docs/decisions/006-optimistic-concurrency.md.
// Create the order without sending must also carry a submission token, so a double press acts once.
// A failure means a form could move a quote on figures its reader never saw.
// It finds a form by its source text, so a form that changes shape needs this test changed with it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const PANEL = resolve(__dirname, 'review', 'act-now-panel.tsx');
const ACTIONS = resolve(__dirname, 'actions.ts');
const CLOSE_PAGE = resolve(__dirname, 'close', 'page.tsx');
const CLOSE_ACTIONS = resolve(__dirname, 'close', 'actions.ts');

const RECORD_FILES = [
  resolve(__dirname, 'page.tsx'),
  resolve(__dirname, 'components', 'record-act-now.tsx'),
  resolve(__dirname, 'components', 'quote-rare-acts.tsx'),
];

function formsPostingTo(source: string, action: string): string[] {
  return source
    .split(`<form action={${action}}`)
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf('</form>')));
}

describe("the quote's transition forms", () => {
  it("step 4's Request price approval and Send carry the generation", () => {
    const panel = readFileSync(PANEL, 'utf8');
    const request = formsPostingTo(panel, 'transitionQuoteAction');

    expect(request).toHaveLength(1);
    expect(request[0]).toContain('value="override_requested"');
    expect(request[0]).toContain('name="lockVersion"');
    expect(request[0]).toContain('value={quote.lockVersion}');
    const send = panel.split('<form action={sendQuoteAction}')[1] ?? '';

    expect(send.indexOf('</form>')).toBeGreaterThan(0);
    expect(send.slice(0, send.indexOf('</form>'))).toContain('value={quote.lockVersion}');
  });

  it("step 4's Override the floor carries the generation, and its action reads it", () => {
    const override = formsPostingTo(readFileSync(PANEL, 'utf8'), 'overrideFloorAction');
    expect(override).toHaveLength(1);
    expect(override[0]).toContain('name="lockVersion"');
    expect(override[0]).toContain('value={quote.lockVersion}');
    expect(override[0]).toContain('name="reason"');
    const actions = readFileSync(ACTIONS, 'utf8');
    const body = actions.slice(actions.indexOf('export async function overrideFloorAction'));
    expect(body).toContain("requireString(formData, 'lockVersion')");
  });

  it("step 4's Create the order without sending carries the generation and a token", () => {
    const forms = formsPostingTo(readFileSync(PANEL, 'utf8'), 'createOrderWithoutSendingAction');
    expect(forms).toHaveLength(1);
    const [form] = forms;
    expect(form).not.toBe('');
    expect(form).toContain('name="lockVersion"');
    expect(form).toContain('value={quote.lockVersion}');

    expect(form).toContain('name={SUBMISSION_TOKEN_FIELD}');
    expect(form).toContain('value={mintSubmissionToken()}');

    expect(form).not.toContain('name="to"');

    const actions = readFileSync(ACTIONS, 'utf8');
    const start = actions.indexOf('export async function createOrderWithoutSendingAction');
    expect(start).toBeGreaterThan(0);
    const end = actions.indexOf(
      '\n/**',
      actions.indexOf('async function markQuotedWithoutSending'),
    );
    const body = actions.slice(start, end);
    expect(body).toContain('withSubmissionToken(optionalString(formData, SUBMISSION_TOKEN_FIELD)');
    expect(body).toContain("requireString(formData, 'lockVersion')");

    expect(body).toContain("JSON.stringify({ to: 'quoted', lockVersion })");
    expect(body).not.toContain("formData, 'to'");

    expect(body).toContain('returnPath(quoteId, FROM_REVIEW)');
    expect(body).toContain('redirect(`${path}/convert`)');
  });

  it('no file of the record page posts closed_lost', () => {
    for (const file of RECORD_FILES) {
      expect(readFileSync(file, 'utf8'), file).not.toContain('value="closed_lost"');
    }
  });

  it('is read by the action that posts it', () => {
    expect(readFileSync(ACTIONS, 'utf8')).toContain("requireString(formData, 'lockVersion')");
  });
});

describe("the close's confirm page", () => {
  const forms = formsPostingTo(readFileSync(CLOSE_PAGE, 'utf8'), 'closeAsLostAction');

  it('has exactly one form, and it carries the generation it was drawn from', () => {
    expect(forms).toHaveLength(1);
    const [form] = forms;
    expect(form).not.toBe('');
    expect(form).toContain('name="lockVersion"');
    expect(form).toContain('value={quote.lockVersion}');
  });

  it('is read by the action that posts it, which moves to closed_lost and nothing else', () => {
    const action = readFileSync(CLOSE_ACTIONS, 'utf8');
    expect(action).toContain("requireString(formData, 'lockVersion')");
    expect(action).toContain("to: 'closed_lost'");
  });
});
