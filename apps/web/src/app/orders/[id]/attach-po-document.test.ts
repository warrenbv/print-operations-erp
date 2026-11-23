// Tests attaching a PO document and recognising a chosen file.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RECEIVED_DOCUMENT_MAX_BYTES } from '@erp/types';

const api = vi.hoisted(() => ({
  fetch: vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(),
}));

vi.mock('../../../lib/api-fetch', () => ({
  apiFetch: (path: string, init?: RequestInit) => api.fetch(path, init),
}));

const { attachPoDocument, chosenFile } = await import('./attach-po-document');

const ORDER_ID = '0192f6c4-7a1b-7c3d-8e9f-0a1b2c3d4e5f';

function pdf(bytes: number, name = 'po.pdf'): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });
}

afterEach(() => {
  api.fetch.mockReset();
});

describe('attachPoDocument', () => {
  it("posts the file as multipart under 'file' to the order's PO document route", async () => {
    api.fetch.mockResolvedValue(new Response('{}', { status: 201 }));

    await expect(attachPoDocument(ORDER_ID, pdf(3529))).resolves.toBeUndefined();

    expect(api.fetch).toHaveBeenCalledTimes(1);
    const [path, init] = api.fetch.mock.calls[0] ?? [];
    expect(path).toBe(`/orders/${ORDER_ID}/purchase-order/document`);
    expect(init?.method).toBe('POST');
    const body = init?.body;
    expect(body).toBeInstanceOf(FormData);
    const sent = (body as FormData).get('file');
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe('po.pdf');
    expect((sent as File).size).toBe(3529);
  });

  it('refuses a file over the limit with its size, and sends nothing', async () => {
    await expect(attachPoDocument(ORDER_ID, pdf(RECEIVED_DOCUMENT_MAX_BYTES + 1))).resolves.toBe(
      'That file is 25.1 MB, and the limit is 25 MB. Save a smaller copy and attach it again.',
    );
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("gives an api refusal in the attach form's own words", async () => {
    api.fetch.mockResolvedValue(
      new Response(JSON.stringify({ reason: 'unsupported-document-type' }), { status: 415 }),
    );

    await expect(attachPoDocument(ORDER_ID, pdf(64, 'po.txt'))).resolves.toBe(
      'Attaching the document failed: only a PDF can be attached here. Save or export the file as a PDF, then attach it again.',
    );
  });
});

describe('chosenFile', () => {
  it('reads an empty file box, or no entry at all, as nothing chosen', () => {
    expect(chosenFile(new File([], '', { type: 'application/octet-stream' }))).toBeUndefined();
    expect(chosenFile(null)).toBeUndefined();
    expect(chosenFile('po.pdf')).toBeUndefined();
  });

  it('answers the file when one was chosen', () => {
    const file = pdf(10);
    expect(chosenFile(file)).toBe(file);
  });
});
