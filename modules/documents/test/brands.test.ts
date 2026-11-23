// The demo letterhead, and the rule that the brand is a parameter: no template names the business in
// code. Comments are stripped before the scan.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEMO_BRAND, brandShortLine, brandedFooter, letterheadBlock } from '../src/brands';

describe('DEMO_BRAND', () => {
  it('prints the Demo Printworks letterhead', () => {
    expect(letterheadBlock(DEMO_BRAND)).toEqual({
      type: 'letterhead',
      nameLines: ['DEMO', 'PRINTWORKS'],
      detailLines: ['100 EXAMPLE WAY', 'EXAMPLE CITY, ID 83000', 'TELEPHONE 208-555-0142'],
    });
  });

  it('uses the business name', () => {
    expect(DEMO_BRAND.name).toBe('Demo Printworks');
  });

  it('signs a page with its name and phone', () => {
    expect(brandShortLine(DEMO_BRAND)).toBe('Demo Printworks · 208-555-0142');
    expect(brandedFooter(DEMO_BRAND)).toBe('Demo Printworks · 208-555-0142');
    expect(brandedFooter(DEMO_BRAND, 'Quote Q-00318')).toBe(
      'Quote Q-00318 · Demo Printworks · 208-555-0142',
    );
  });
});

describe('the brand is a parameter', () => {
  it('leaves no template naming a business in a string', () => {
    const dir = resolve(__dirname, '../src/templates');
    const files = readdirSync(dir)
      .map((name) => join(dir, name))
      .filter((file) => file.endsWith('.ts'));

    const offenders = files.filter((file) => {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      return /Demo Printworks|208.*555.*0142/i.test(code);
    });

    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(offenders).toEqual([]);
  });
});
