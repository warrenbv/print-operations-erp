// Tests for the page text components. Each component is called as a function and its element read.
import { describe, expect, it } from 'vitest';

import { DATA_LINE_STYLE, DataLine, Explainer, PageLede, SectionNote } from './helptext';
import { COLOR, FONT_SIZE, MEASURE, SPACE } from './tokens';

describe('MEASURE', () => {
  it('holds the note and lede measures', () => {
    expect(MEASURE).toEqual({ note: 560, lede: 640 });
  });
});

describe('PageLede', () => {
  it('is a muted paragraph at the lede measure', () => {
    const el = PageLede({ children: 'What each jurisdiction charges.' });
    expect(el?.type).toBe('p');
    expect(el?.props.style).toEqual({
      color: COLOR.muted,
      fontSize: FONT_SIZE.md,
      margin: `${SPACE.xs} 0 ${SPACE.xl}`,
      maxWidth: MEASURE.lede,
    });
    expect(el?.props.children).toBe('What each jurisdiction charges.');
  });
});

describe('SectionNote', () => {
  it('is a small muted paragraph at the note measure', () => {
    const el = SectionNote({ children: 'Check first.' });
    expect(el?.type).toBe('p');
    expect(el?.props.style).toEqual({
      color: COLOR.muted,
      fontSize: FONT_SIZE.sm,
      margin: `0 0 ${SPACE.lg}`,
      maxWidth: MEASURE.note,
    });
  });
});

describe('DataLine', () => {
  it('is a small muted paragraph', () => {
    const el = DataLine({ children: 'Showing September 2026.' });
    expect(el?.type).toBe('p');
    expect(el?.props.style).toEqual({
      color: COLOR.muted,
      fontSize: FONT_SIZE.sm,
      margin: `0 0 ${SPACE.lg}`,
    });
    expect(el?.props.style).toBe(DATA_LINE_STYLE);
  });

  it('never reads larger than the lede above it', () => {
    const rem = (size: string) => Number.parseFloat(size);
    const lede = PageLede({ children: 'x' })?.props.style.fontSize as string;
    expect(rem(DATA_LINE_STYLE.fontSize)).toBeLessThanOrEqual(rem(lede));
    expect(DATA_LINE_STYLE.fontSize.endsWith('rem')).toBe(true);
    expect(lede.endsWith('rem')).toBe(true);
  });
});

describe('the empty rule, shared with the banners', () => {
  const empty = [undefined, null, false, ''] as const;

  for (const children of empty) {
    it(`renders nothing for ${JSON.stringify(children) ?? 'undefined'}`, () => {
      expect(PageLede({ children })).toBeNull();
      expect(SectionNote({ children })).toBeNull();
      expect(DataLine({ children })).toBeNull();
    });
  }
});

describe('Explainer', () => {
  const el = Explainer({ summary: 'Which file to load', children: 'The Rates file.' });
  const [summary, body] = el.props.children;

  it('is a native disclosure that starts closed', () => {
    expect(el.type).toBe('details');
    expect(el.props.open).toBeUndefined();
    expect(summary.type).toBe('summary');
    expect(summary.props.children).toBe('Which file to load');
  });

  it('styles the summary muted and clickable', () => {
    expect(summary.props.style).toEqual({
      color: COLOR.muted,
      fontSize: FONT_SIZE.sm,
      cursor: 'pointer',
    });
  });

  it('sets the body in the text colour, because a reader who opened it wants to read it', () => {
    expect(body.type).toBe('div');
    expect(body.props.style).toEqual({
      color: COLOR.text,
      fontSize: FONT_SIZE.sm,
      maxWidth: MEASURE.note,
      padding: `${SPACE.sm} 0 0 ${SPACE.lg}`,
    });
    expect(body.props.children).toBe('The Rates file.');
  });
});
