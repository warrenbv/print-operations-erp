// Rendering through `DocumentService`: template registration and the generated filename.
import { describe, expect, it } from 'vitest';
import type { DocumentModel } from '../src/document-model';
import { NoTemplateForKindError } from '../src/ports';
import { DocumentService, documentFilename } from '../src/services/document-service';

const model: DocumentModel = {
  title: 'Quote Q-0517 v1',
  blocks: [{ type: 'heading', title: 'Quote' }],
};

const fixedClock = { now: () => new Date('2026-08-10T12:00:00.000Z') };

const fakeRenderer = { render: async () => new Uint8Array([1, 2, 3]) };

const service = (supportedKinds?: Parameters<typeof makeService>[0]) => makeService(supportedKinds);

function makeService(supportedKinds?: readonly ('quote' | 'order_confirmation')[]) {
  return new DocumentService({
    renderer: fakeRenderer,
    clock: fixedClock,
    ...(supportedKinds ? { supportedKinds } : {}),
  });
}

describe('DocumentService', () => {
  it('returns the rendered bytes with a stamped filename', async () => {
    const rendered = await service().render('quote', 'Q-0517', model);

    expect(rendered.kind).toBe('quote');
    expect(rendered.contentType).toBe('application/pdf');
    expect(rendered.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(rendered.filename).toBe('quote-Q-0517-20260810.pdf');
    expect(rendered.generatedAt).toBe('2026-08-10T12:00:00.000Z');
  });

  it('refuses a kind that has no template, and says which exist', async () => {
    await expect(service().render('order_confirmation', 'ORD-9', model)).rejects.toBeInstanceOf(
      NoTemplateForKindError,
    );
    await expect(service().render('order_confirmation', 'ORD-9', model)).rejects.toThrow(
      /registered: quote/,
    );
  });

  it('renders a kind once its template is registered', async () => {
    const rendered = await service(['quote', 'order_confirmation']).render(
      'order_confirmation',
      'ORD-9',
      model,
    );
    expect(rendered.filename).toBe('order-confirmation-ORD-9-20260810.pdf');
  });
});

describe('documentFilename', () => {
  it('flattens the kind and dates the file', () => {
    expect(
      documentFilename('order_confirmation', 'ORD-9', new Date('2026-12-01T00:00:00.000Z')),
    ).toBe('order-confirmation-ORD-9-20261201.pdf');
  });

  it('strips characters that would change the path', () => {
    expect(documentFilename('quote', 'Q/0731 rev 2', new Date('2026-08-10T00:00:00.000Z'))).toBe(
      'quote-Q-0731-rev-2-20260810.pdf',
    );
  });

  it('names a quote file by its quote number and version', () => {
    const at = new Date('2026-08-10T00:00:00.000Z');
    expect(documentFilename('quote', 'Q-00318', at)).toBe('quote-Q-00318-20260810.pdf');
    expect(documentFilename('quote', 'Q-00318 v2', at)).toBe('quote-Q-00318-v2-20260810.pdf');
  });
});
