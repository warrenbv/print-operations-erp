// Streams a stored document with headers that stop the browser guessing its type.
import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

export function sendStoredDocument(
  res: Response,
  document: { filename: string; contentType: string; originalFilename?: string | null },
  bytes: Uint8Array,
  options: { inline: boolean },
): StreamableFile {
  res.set({
    'Content-Type': document.contentType,
    'X-Content-Type-Options': 'nosniff',

    'Content-Disposition': contentDisposition(
      document.originalFilename ?? document.filename,
      document.filename,
      options.inline,
    ),
  });
  return new StreamableFile(Buffer.from(bytes));
}

// `filename` is an ASCII fallback built from the stored name. `filename*` carries the display name in UTF-8.
function contentDisposition(display: string, storedName: string, inline: boolean): string {
  const disposition = inline ? 'inline' : 'attachment';

  const ascii = storedName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const fallback = ascii.trim() === '' ? 'document' : ascii;
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(display)}`;
}
