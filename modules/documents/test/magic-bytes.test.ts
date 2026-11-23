// Identifying received files by their bytes, including the zip limit for DOCX and XLSX.
import { describe, expect, it } from 'vitest';

import { identifyReceivedBytes } from '../src/magic-bytes';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const withPrefix = (...prefix: number[]) => Uint8Array.from([...prefix, ...Array(64).fill(0)]);

const PDF = withPrefix(0x25, 0x50, 0x44, 0x46);
const JPEG = withPrefix(0xff, 0xd8, 0xff, 0xe0);
const PNG = withPrefix(0x89, 0x50, 0x4e, 0x47);
const TIFF_LE = withPrefix(0x49, 0x49, 0x2a, 0x00);
const TIFF_BE = withPrefix(0x4d, 0x4d, 0x00, 0x2a);
const ZIP = withPrefix(0x50, 0x4b, 0x03, 0x04);

describe('identifyReceivedBytes — the bytes decide', () => {
  it('identifies each non-zip format from its signature alone', () => {
    expect(identifyReceivedBytes(PDF, 'text/plain')).toBe('application/pdf');
    expect(identifyReceivedBytes(JPEG, 'application/pdf')).toBe('image/jpeg');
    expect(identifyReceivedBytes(PNG, 'application/pdf')).toBe('image/png');
    expect(identifyReceivedBytes(TIFF_LE, 'image/png')).toBe('image/tiff');
    expect(identifyReceivedBytes(TIFF_BE, 'image/png')).toBe('image/tiff');
  });

  it('refuses bytes that match nothing, whatever the client claims', () => {
    const html = Uint8Array.from(Buffer.from('<html><script>alert(1)</script>'));
    expect(identifyReceivedBytes(html, 'application/pdf')).toBeNull();

    const svg = Uint8Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'));
    expect(identifyReceivedBytes(svg, 'image/png')).toBeNull();

    const exe = withPrefix(0x4d, 0x5a);
    expect(identifyReceivedBytes(exe, 'application/pdf')).toBeNull();
  });

  it('refuses an empty or truncated file rather than reading past the end', () => {
    expect(identifyReceivedBytes(new Uint8Array(), 'application/pdf')).toBeNull();

    expect(identifyReceivedBytes(Uint8Array.from([0x25, 0x50]), 'application/pdf')).toBeNull();
  });
});

describe('identifyReceivedBytes — the zip limitation, stated', () => {
  it('accepts a zip only when the claim names one of the two OOXML formats', () => {
    expect(identifyReceivedBytes(ZIP, DOCX)).toBe(DOCX);
    expect(identifyReceivedBytes(ZIP, XLSX)).toBe(XLSX);
  });

  it('refuses a zip claiming to be anything else', () => {
    expect(identifyReceivedBytes(ZIP, 'application/zip')).toBeNull();
    expect(identifyReceivedBytes(ZIP, 'application/pdf')).toBeNull();
    expect(identifyReceivedBytes(ZIP, '')).toBeNull();
  });

  it('cannot tell a renamed archive from a real DOCX — and that is documented', () => {
    expect(identifyReceivedBytes(ZIP, DOCX)).toBe(DOCX);
  });
});
