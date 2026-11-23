// Tests for the queue tables, queue cards and count badge. Each component is called as a function and its element read.
import { describe, expect, it } from 'vitest';

import { TableScroll } from './layout';
import {
  AgeCell,
  CountBadge,
  QueueCard,
  QueueCardRow,
  QueueCell,
  QueueGroupRow,
  QueueTable,
  RowLink,
} from './queue';
import { COLOR, FONT_SIZE } from './tokens';

describe('QueueTable', () => {
  const el = QueueTable({
    columns: [{ label: 'Quote' }, { label: 'Waiting', num: true }],
    children: null,
  });
  const table = el.props.children;

  it('is a framed table in its own sideways scroll', () => {
    expect(el.type).toBe(TableScroll);
    expect(table.type).toBe('table');
    expect(table.props.style.border).toContain(COLOR.border);
    expect(table.props.style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('draws one quiet header cell per column, right-aligned for a number', () => {
    const [, thead] = table.props.children;
    const cells = thead.props.children.props.children;
    expect(cells).toHaveLength(2);
    expect(cells[0].type).toBe('th');
    expect(cells[0].props.style.background).toBe(COLOR.surface);
    expect(cells[0].props.style.color).toBe(COLOR.muted);
    expect(cells[0].props.style.fontSize).toBe(FONT_SIZE.sm);
    expect(cells[0].props.style.textAlign).toBe('left');
    expect(cells[1].props.style.textAlign).toBe('right');
  });

  it('draws no caption unless given', () => {
    expect(table.props.children[0]).toBeNull();
  });

  it('draws a muted caption on top', () => {
    const captioned = QueueTable({ columns: [{ label: 'A' }], caption: 'x', children: null });
    const [caption] = captioned.props.children.props.children;
    expect(caption.type).toBe('caption');
    expect(caption.props.style.captionSide).toBe('top');
    expect(caption.props.style.color).toBe(COLOR.muted);
    expect(caption.props.children).toBe('x');
  });

  it('marks the sorted column for a screen reader', () => {
    const sorted = QueueTable({
      columns: [{ label: 'A' }, { label: 'B', sort: 'descending' }],
      children: null,
    });
    const [, thead] = sorted.props.children.props.children;
    const cells = thead.props.children.props.children;
    expect(cells[0].props['aria-sort']).toBeUndefined();
    expect(cells[1].props['aria-sort']).toBe('descending');
  });
});

describe('the queue rows', () => {
  it('right-aligns a number cell', () => {
    expect(QueueCell({ children: 'a' }).props.style.textAlign).toBe('left');
    expect(QueueCell({ num: true, children: '1' }).props.style.textAlign).toBe('right');
  });

  it('spans a group row across the columns, on the surface', () => {
    const td = QueueGroupRow({ span: 6, children: 'Your move (2)' }).props.children;
    expect(td.type).toBe('td');
    expect(td.props.colSpan).toBe(6);
    expect(td.props.style.background).toBe(COLOR.surface);
  });

  it('links the first cell in bold', () => {
    const el = RowLink({ href: '/quoting/quotes/1', children: 'Q-00047' });
    expect(el.type).toBe('a');
    expect(el.props.href).toBe('/quoting/quotes/1');
    expect(el.props.style.fontWeight).toBe(600);
  });

  it('mutes an age and turns a late one amber', () => {
    const plain = AgeCell({ children: '4 days' });
    expect(plain.type).toBe('td');
    expect(plain.props.style.color).toBe(COLOR.muted);
    expect(plain.props.style.textAlign).toBe('right');
    const late = AgeCell({ children: '19 days', late: true });
    expect(late.props.style.color).toBe(COLOR.warning);
    expect(late.props.style.fontWeight).toBe(600);
  });
});

describe('QueueCard', () => {
  function count(card: ReturnType<typeof QueueCard>) {
    return card.props.children[0].props.children[1];
  }

  it('shows the count in accent while anything waits', () => {
    const n = count(QueueCard({ title: 'Waiting on you', count: 2, children: null }));
    expect(n.props.children).toBe(2);
    expect(n.props.style.color).toBe(COLOR.accent);
  });

  it('mutes the count at zero', () => {
    const n = count(QueueCard({ title: 'Quoted', count: 0, children: null }));
    expect(n.props.style.color).toBe(COLOR.muted);
  });

  it('draws no count when none is given', () => {
    expect(count(QueueCard({ title: 'Sales', children: null }))).toBeNull();
  });

  it('puts the rows in a reset list under an h3', () => {
    const [h3, ul] = QueueCard({ title: 'x', children: null }).props.children;
    expect(h3.type).toBe('h3');
    expect(ul.type).toBe('ul');
    expect(ul.props.style.listStyle).toBe('none');
  });

  it('ends in a link or a muted line', () => {
    const linked = QueueCard({
      title: 'x',
      foot: { text: 'All quotes', href: '/quoting/quotes' },
      children: null,
    }).props.children[2];
    expect(linked.type).toBe('a');
    expect(linked.props.href).toBe('/quoting/quotes');
    const line = QueueCard({ title: 'x', foot: { text: 'Later.' }, children: null }).props
      .children[2];
    expect(line.type).toBe('p');
    expect(line.props.style.color).toBe(COLOR.muted);
    expect(QueueCard({ title: 'x', children: null }).props.children[2]).toBeNull();
  });

  it('draws a row as a link with its age at the right, amber when late', () => {
    const li = QueueCardRow({ href: '/q/1', children: 'Q-00047', age: '19 days', late: true });
    expect(li.type).toBe('li');
    const [a, age] = li.props.children;
    expect(a.type).toBe('a');
    expect(age.props.children).toBe('19 days');
    expect(age.props.style.color).toBe(COLOR.warning);
    const plain = QueueCardRow({ href: '/q/1', children: 'Q', age: '1 day' }).props.children[1];
    expect(plain.props.style.color).toBeUndefined();
  });
});

describe('CountBadge', () => {
  it('draws nothing at zero', () => {
    expect(CountBadge({ count: 0 })).toBeNull();
  });

  it('draws the count on the soft accent', () => {
    const el = CountBadge({ count: 3 });
    expect(el?.type).toBe('span');
    expect(el?.props.children).toBe(3);
    expect(el?.props.style.background).toBe(COLOR.accentSoft);
    expect(el?.props.style.color).toBe(COLOR.text);
  });
});
