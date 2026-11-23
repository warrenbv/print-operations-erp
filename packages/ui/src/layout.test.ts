// Tests for the page frame and block components. Each component is called as a function and its element read.
import { describe, expect, it } from 'vitest';

import { SectionNote } from './helptext';
import {
  Box,
  DL,
  EmptyState,
  PageShell,
  ResetList,
  Section,
  StatusChip,
  TableScroll,
} from './layout';
import { COLOR, FONT_SIZE, PRINT_CLASS } from './tokens';

describe('PageShell', () => {
  it('centres the page', () => {
    expect(PageShell({ children: null }).props.style.margin).toBe('0 auto');
  });

  it('puts every page on one frame, 1100 wide', () => {
    expect(PageShell({ children: null }).props.style.maxWidth).toBe(1100);
  });

  it('takes no width, so no page can leave the frame', () => {
    // @ts-expect-error -- intentional
    expect(PageShell({ children: null, width: 'full' }).props.style.maxWidth).toBe(1100);
  });

  it('is a main landmark', () => {
    expect(PageShell({ children: null }).type).toBe('main');
  });

  it('marks a printable page for the print block, and only that page', () => {
    expect(PageShell({ children: null, printable: true }).props.className).toBe(PRINT_CLASS.report);
    expect(PageShell({ children: null }).props.className).toBeUndefined();

    expect(PageShell({ children: null, printable: true }).props.style).toEqual(
      PageShell({ children: null }).props.style,
    );
  });
});

describe('TableScroll', () => {
  it('lets a wide table scroll sideways inside its own block', () => {
    const el = TableScroll({ children: 'x' });
    expect(el.type).toBe('div');
    expect(el.props.style.overflowX).toBe('auto');
    expect(el.props.children).toBe('x');
  });

  it('carries the class the print block drops the scroll by', () => {
    expect(TableScroll({ children: 'x' }).props.className).toBe(PRINT_CLASS.scroll);
  });
});

describe('StatusChip', () => {
  it('draws a neutral chip on the surface with a grey border', () => {
    const el = StatusChip({ children: 'Draft' });
    expect(el.props.style.color).toBe(COLOR.text);
    expect(el.props.style.background).toBe(COLOR.surface);
    expect(el.props.style.border).toContain(COLOR.border);
  });

  it.each([
    ['now', COLOR.accent, COLOR.accentSoft],
    ['pending', COLOR.warning, COLOR.warningSoft],
    ['done', COLOR.success, COLOR.successSoft],
    ['problem', COLOR.danger, COLOR.dangerSoft],
  ] as const)('draws %s with its soft fill and a border in its colour', (tone, border, fill) => {
    const el = StatusChip({ children: 'x', tone });
    expect(el.props.style.background).toBe(fill);
    expect(el.props.style.border).toContain(border);
  });

  it('draws warning, success and danger the same as pending, done and problem', () => {
    for (const [alias, name] of [
      ['warning', 'pending'],
      ['success', 'done'],
      ['danger', 'problem'],
    ] as const) {
      expect(StatusChip({ children: 'x', tone: alias }).props.style).toEqual(
        StatusChip({ children: 'x', tone: name }).props.style,
      );
    }
  });

  it('writes the word in the text colour on every tone', () => {
    for (const tone of ['neutral', 'now', 'pending', 'done', 'problem'] as const) {
      expect(StatusChip({ children: 'x', tone }).props.style.color).toBe(COLOR.text);
    }
  });
});

describe('Section', () => {
  it('renders a section landmark with an h2 at the large size', () => {
    const el = Section({ title: 'Lines', children: null });
    expect(el.type).toBe('section');
    const heading = el.props.children[0];
    expect(heading.type).toBe('h2');
    expect(heading.props.style.fontSize).toBe(FONT_SIZE.lg);
  });

  it('carries an id a next-step link can land on, and none by default', () => {
    expect(Section({ title: 'Delivery', id: 'delivery', children: null }).props.id).toBe(
      'delivery',
    );
    expect(Section({ title: 'Lines', children: null }).props.id).toBeUndefined();
  });

  it('places its note between the title and the children, through SectionNote', () => {
    const el = Section({ title: 'Load a quarter', note: 'Check first.', children: 'form' });
    const [heading, note, body] = el.props.children;
    expect(heading.type).toBe('h2');
    expect(note.type).toBe(SectionNote);
    expect(note.props.children).toBe('Check first.');
    expect(body).toBe('form');
  });

  it('draws no note when none is given', () => {
    const el = Section({ title: 'Lines', children: null });
    const note = el.props.children[1];
    expect(note.type).toBe(SectionNote);

    expect(SectionNote(note.props)).toBeNull();
  });
});

describe('the block components', () => {
  it('lets a caller override Box padding without losing the border', () => {
    const el = Box({ children: null, style: { padding: 0 } });
    expect(el.props.style.padding).toBe(0);
    expect(el.props.style.border).toContain(COLOR.border);
  });

  it('strips the browser list styling', () => {
    const el = ResetList({ children: null });
    expect(el.type).toBe('ul');
    expect(el.props.style.listStyle).toBe('none');
    expect(el.props.style.padding).toBe(0);
  });

  it('renders a definition grid as a real dl', () => {
    const el = DL({ children: null });
    expect(el.type).toBe('dl');
    expect(el.props.style.gridTemplateColumns).toBe('max-content 1fr');
  });

  it('mutes an empty state instead of alarming about it', () => {
    expect(EmptyState({ children: 'Nothing to do.' }).props.style.color).toBe(COLOR.muted);
  });
});
