// Tests for the record page parts. Each component is called as a function and its element read.
import { describe, expect, it } from 'vitest';

import { PageLede } from './helptext';
import { Box, StatusChip } from './layout';
import {
  Crumb,
  FoldGroup,
  KV,
  LineSummary,
  RareActs,
  RecordHead,
  StepStrip,
  type StripStep,
} from './record';
import { COLOR, FONT_SIZE, RECORD_CLASS, SPACE } from './tokens';

const SEVEN: StripStep[] = [
  { label: 'Quote', state: 'done', note: 'Sep 30' },
  { label: 'Order', state: 'done', note: 'Oct 2' },
  { label: 'Confirmed', state: 'current', note: 'With Sales, 2 days' },
  { label: 'Production', state: 'gated', note: 'Waits on the confirmation' },
  { label: 'Shipped', state: 'todo' },
  { label: 'Invoiced', state: 'todo' },
  { label: 'Paid', state: 'na' },
];

type Element = ReturnType<typeof StepStrip>;

function cells(steps: StripStep[]): Element[] {
  return StepStrip({ steps }).props.children.props.children;
}

function words(cell: Element) {
  const inner = cell.props.children;
  const fragment = inner.type === 'a' ? inner.props.children : inner;
  const [label, note] = fragment.props.children;
  return { label, note, link: inner.type === 'a' ? inner : undefined };
}

describe('StepStrip', () => {
  it('is a nav named Step strip around an ol the class lays out', () => {
    const el = StepStrip({ steps: SEVEN });
    expect(el.type).toBe('nav');
    expect(el.props['aria-label']).toBe('Step strip');
    const ol = el.props.children;
    expect(ol.type).toBe('ol');
    expect(ol.props.className).toBe(RECORD_CLASS.strip);

    expect(ol.props.style.gridAutoFlow).toBeUndefined();
    expect(ol.props.style.gridAutoColumns).toBeUndefined();
  });

  it('renders one cell per step', () => {
    expect(cells(SEVEN)).toHaveLength(7);
  });

  it('draws a done step in success with a hidden tick before its label', () => {
    const [quote] = cells(SEVEN);
    expect(quote!.props.style.background).toBe(COLOR.successSoft);
    expect(quote!.props.style.borderColor).toBe(COLOR.success);
    const { label, note } = words(quote!);
    const [tick, text] = label.props.children;
    expect(tick.props['aria-hidden']).toBe('true');
    expect(tick.props.style.color).toBe(COLOR.success);
    expect(text).toBe('Quote');
    expect(note).toBe('Sep 30');
  });

  it('marks the current step in accent, its note in text colour', () => {
    const current = cells(SEVEN)[2]!;
    expect(current.props['aria-current']).toBe('step');
    expect(current.props.style.background).toBe(COLOR.accentSoft);
    expect(current.props.style.borderColor).toBe(COLOR.accent);
    expect(current.props.style.color).toBe(COLOR.text);
    const { label, note } = words(current);
    expect(label.props.style.color).toBe(COLOR.accent);
    expect(note).toBe('With Sales, 2 days');
  });

  it('draws a gated step in warning with its gate as the note', () => {
    const gated = cells(SEVEN)[3]!;
    expect(gated.props.style.background).toBe(COLOR.warningSoft);
    expect(gated.props.style.borderColor).toBe(COLOR.warning);
    expect(words(gated).note).toBe('Waits on the confirmation');
  });

  it('draws a step to come on the surface, with no tick and no current mark', () => {
    const todo = cells(SEVEN)[4]!;
    expect(todo.props.style.background).toBe(COLOR.surface);
    expect(todo.props['aria-current']).toBeUndefined();
    const [tick, text] = words(todo).label.props.children;
    expect(tick).toBe(false);
    expect(text).toBe('Shipped');
  });

  it('draws a step that does not apply at 55% opacity', () => {
    const na = cells(SEVEN)[6]!;
    expect(na.props.style.opacity).toBe(0.55);
    expect(cells(SEVEN)[4]!.props.style.opacity).toBeUndefined();
  });

  it('always says the label in text, whatever the state', () => {
    for (const [index, cell] of cells(SEVEN).entries()) {
      const [, text] = words(cell).label.props.children;
      expect(text).toBe(SEVEN[index]!.label);
    }
  });

  it('makes a step a link only when it has an href', () => {
    const [linked] = cells([{ label: 'Order', state: 'todo', href: '/pipeline?step=order' }]);
    const { link } = words(linked!);
    expect(link?.props.href).toBe('/pipeline?step=order');
    expect(link?.props.style.color).toBe('inherit');
    expect(words(cells(SEVEN)[0]!).link).toBeUndefined();
  });
});

describe('Crumb', () => {
  it('links back through each item and leaves this record plain', () => {
    const el = Crumb({ items: [{ label: 'Orders', href: '/orders' }, { label: 'SO-3816' }] })!;
    expect(el.type).toBe('nav');
    expect(el.props['aria-label']).toBe('Breadcrumb');
    const [first, last] = el.props.children.props.children;
    const [firstSep, firstLink] = first.props.children;
    expect(firstSep).toBe(false);
    expect(firstLink.type).toBe('a');
    expect(firstLink.props.href).toBe('/orders');
    const [sep, plain] = last.props.children;
    expect(sep).toBe(' / ');
    expect(plain).toBe('SO-3816');
  });

  it('renders nothing for no items', () => {
    expect(Crumb({ items: [] })).toBeNull();
  });
});

describe('RecordHead', () => {
  it('puts the chip beside the h1, not inside it, and the lede under them', () => {
    const el = RecordHead({
      crumb: [{ label: 'Orders', href: '/orders' }, { label: 'SO-3816' }],
      title: 'SO-3816',
      chip: { label: 'Waiting on confirmation', tone: 'pending' },
      lede: 'Lantern Supply Co',
    });
    const [crumb, row, lede] = el.props.children;
    expect(crumb.type).toBe(Crumb);
    const [h1, chip] = row.props.children;
    expect(h1.type).toBe('h1');
    expect(h1.props.style.margin).toBe(0);
    expect(h1.props.children).toBe('SO-3816');
    expect(chip.type).toBe(StatusChip);
    expect(chip.props.tone).toBe('pending');
    expect(chip.props.children).toBe('Waiting on confirmation');
    expect(lede.type).toBe(PageLede);
    expect(lede.props.children).toBe('Lantern Supply Co');
  });

  it('leaves the chip and the crumb out when they are not given', () => {
    const [crumb, row] = RecordHead({ title: 'Q-5873' }).props.children;
    expect(crumb).toBe(false);
    const [, chip] = row.props.children;
    expect(chip).toBe(false);
  });
});

describe('KV', () => {
  it('is a dl the class lays out, with no inline columns', () => {
    const el = KV({ children: null });
    expect(el.type).toBe('dl');
    expect(el.props.className).toBe(RECORD_CLASS.kv);
    expect(el.props.style.gridTemplateColumns).toBeUndefined();
  });
});

describe('LineSummary', () => {
  const row = {
    id: 'line-1',
    spec: 'Line 1 · Butcher 40#',
    delivery: 'Freight · Demo Falls, ID',
    price: '$41.20 / roll delivered',
    note: 'Trade tier.',
  };

  it('is a soft card holding the anchored row and the note', () => {
    const el = LineSummary({ ...row, edit: { href: '?edit=1#line-1', label: 'Edit line 1' } });
    expect(el.type).toBe(Box);
    expect(el.props.style.background).toBe(COLOR.surface);
    const [grid, p] = el.props.children;
    expect(grid.props.id).toBe('line-1');
    const [spec, delivery, price] = grid.props.children;
    expect(spec.props.children).toBe(row.spec);
    expect(delivery.props.children).toBe(row.delivery);
    expect(price.props.children).toBe(row.price);
    const [note, edit] = p.props.children;
    expect(note).toBe(row.note);
    const [, link] = edit.props.children;
    expect(link.type).toBe('a');
    expect(link.props.href).toBe('?edit=1#line-1');
    expect(link.props.children).toBe('Edit line 1');
  });

  it('has no edit link when there is no edit', () => {
    const [, p] = LineSummary(row).props.children;
    const [, edit] = p.props.children;
    expect(edit).toBe(false);
  });
});

describe('FoldGroup', () => {
  it('stacks its folds on a grid', () => {
    const el = FoldGroup({ children: 'folds' });
    expect(el.props.style.display).toBe('grid');
    expect(el.props.style.gap).toBe(SPACE.md);
    expect(el.props.children).toBe('folds');
  });
});

describe('RareActs', () => {
  it('is a section under a rule, headed by a muted Rarely needed', () => {
    const el = RareActs({ children: 'acts' });
    expect(el.type).toBe('section');
    expect(el.props.style.borderTop).toContain(COLOR.border);
    const [h2, children] = el.props.children;
    expect(h2.type).toBe('h2');
    expect(h2.props.children).toBe('Rarely needed');
    expect(h2.props.style.color).toBe(COLOR.muted);
    expect(h2.props.style.fontSize).toBe(FONT_SIZE.md);
    expect(children).toBe('acts');
  });
});
