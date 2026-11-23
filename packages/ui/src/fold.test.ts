// Tests for Fold. The component is called as a function and its element read.
import { describe, expect, it } from 'vitest';

import { Fold } from './fold';
import { COLOR, FOLD_CLASS } from './tokens';

describe('Fold', () => {
  it('is a native details, closed by default', () => {
    const el = Fold({ summary: 'Closed and superseded (2)', children: null });
    expect(el.type).toBe('details');
    expect(el.props.open).toBe(false);
    expect(el.props.className).toBe(FOLD_CLASS.fold);
  });

  it('opens only when the page passes open', () => {
    expect(Fold({ summary: 'x', open: true, children: null }).props.open).toBe(true);
  });

  it('puts the summary, its muted sum and both glyphs in the bar', () => {
    const [summary] = Fold({ summary: 'Delivery', sum: 'collected', children: null }).props
      .children;
    expect(summary.type).toBe('summary');
    expect(summary.props.className).toBe(FOLD_CLASS.bar);
    const [text, sum, closed, opened] = summary.props.children;
    expect(text).toBe('Delivery');
    expect(sum.props.children).toBe('collected');
    expect(sum.props.style.color).toBe(COLOR.muted);
    expect(closed.props.className).toBe(FOLD_CLASS.closedGlyph);
    expect(closed.props['aria-hidden']).toBe('true');
    expect(opened.props.className).toBe(FOLD_CLASS.openGlyph);
  });

  it('draws the body under a rule', () => {
    const [, body] = Fold({ summary: 'x', children: 'inside' }).props.children;
    expect(body.props.style.borderTop).toContain(COLOR.border);
    expect(body.props.children).toBe('inside');
  });
});
